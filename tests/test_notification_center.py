"""Tests for normalized notification channels, rules and providers."""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    AppSetting,
    Base,
    Instance,
    NotificationChannel,
    NotificationContact,
    NotificationLog,
    NotificationRule,
)
from app.schemas.notification import (
    CustomEventPayload,
    NotificationChannelPayload,
    NotificationContactPayload,
    NotificationContactGroupPayload,
    NotificationRulePayload,
    NotificationTestPayload,
)
from app.services import notification_center_service as service
from app.services.app_setting_service import get_runtime_app_settings
from app.services.notification_providers import (
    ProviderMessage,
    _percent_encode,
    aliyun_rpc_call,
    render_template,
)


def _make_db() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


class NotificationCenterServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _make_db()
        self.db.add(AppSetting(notification_center_v2_at=__import__("datetime").datetime.now()))
        self.db.add(
            Instance(
                name="alpha",
                base_url="https://alpha.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                billing_mode="prepaid",
                tags_json=["prod"],
            )
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_channel_secrets_are_not_returned(self) -> None:
        response = service.create_channel(
            self.db,
            NotificationChannelPayload(
                name="运维短信",
                type="aliyun_sms",
                config={"sign_name": "测试", "template_code": "SMS_1"},
                secrets={"access_key_id": "ak", "access_key_secret": "sk"},
            ),
        )
        self.assertTrue(response.has_secrets)
        self.assertEqual(["access_key_id", "access_key_secret"], response.secret_fields)
        self.assertNotIn("sk", json.dumps(response.model_dump(mode="json")))

        row = self.db.scalars(select(NotificationChannel)).one()
        raw = self.db.execute(
            __import__("sqlalchemy").text(
                "SELECT secrets_json FROM notification_channels WHERE id = :id"
            ),
            {"id": row.id},
        ).scalar_one()
        self.assertTrue(str(raw).startswith("enc:v1:"))
        self.assertIn("access_key_secret", json.loads(row.secrets_json or "{}"))

    def test_runtime_settings_use_normalized_channels(self) -> None:
        service.create_channel(
            self.db,
            NotificationChannelPayload(
                name="webhook",
                type="webhook",
                config={"url": "https://example.com/hook"},
            ),
        )
        runtime = get_runtime_app_settings(self.db)
        self.assertEqual(1, len(runtime.notification_channels))
        self.assertEqual("webhook", runtime.notification_channels[0].type)

    def test_custom_event_routes_to_rule_channels_and_contacts(self) -> None:
        channel = service.create_channel(
            self.db,
            NotificationChannelPayload(
                name="sms",
                type="aliyun_sms",
                config={"sign_name": "测试", "template_code": "SMS_1"},
                secrets={"access_key_id": "ak", "access_key_secret": "sk"},
            ),
        )
        contact = service.create_contact(
            self.db,
            NotificationContactPayload(name="值班", type="phone", value="13800138000"),
        )
        group = service.create_contact_group(
            self.db,
            NotificationContactGroupPayload(name="值班组", contact_ids=[contact.id]),
        )
        rule = service.create_rule(
            self.db,
            NotificationRulePayload(
                name="自定义告警",
                event_type="custom",
                delivery={
                    "channel_ids": [channel.id],
                    "contact_group_ids": [group.id],
                },
            ),
        )
        with patch.object(service, "_deliver_message") as deliver:
            deliver.return_value = []
            result = service.dispatch_custom_event(
                self.db,
                CustomEventPayload(
                    title="部署完成",
                    body="v1",
                    event_type="deploy",
                    dedupe_key="deploy-v1",
                ),
            )
        self.assertFalse(result.success)
        deliver.assert_called_once()
        recipients = deliver.call_args.kwargs["recipients"]
        self.assertEqual(["13800138000"], recipients["phone"])
        self.assertEqual(rule.id, self.db.scalars(select(NotificationRule)).one().id)

    def test_rule_rejects_missing_channel_reference(self) -> None:
        with self.assertRaises(Exception):
            service.create_rule(
                self.db,
                NotificationRulePayload(
                    name="bad",
                    event_type="custom",
                    delivery={"channel_ids": ["missing"]},
                ),
            )

    def test_test_notification_marks_failed_channels(self) -> None:
        service.create_channel(
            self.db,
            NotificationChannelPayload(
                name="webhook",
                type="webhook",
                config={"url": "https://example.com/hook"},
            ),
        )
        with patch.object(service, "_deliver_message") as deliver:
            deliver.return_value = []
            result = service.send_test_notification(self.db, NotificationTestPayload())
        self.assertEqual(0, result.total)
        self.assertFalse(result.success)


class ProviderTests(unittest.TestCase):
    def test_template_render_and_percent_encode(self) -> None:
        message = ProviderMessage(title="标题", body="正文", fields={"instance": "alpha"})
        self.assertEqual("alpha/标题", render_template("{{instance}}/{{title}}", message))
        self.assertEqual("a%20b~c", _percent_encode("a b~c"))

    @patch("app.services.notification_providers.httpx.get")
    def test_aliyun_sms_signature_and_success(self, get: MagicMock) -> None:
        get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"Code": "OK", "BizId": "biz-1", "RequestId": "req-1"},
        )
        channel = MagicMock(
            id="channel-1",
            name="sms",
            type="aliyun_sms",
            config={"sign_name": "测试", "template_code": "SMS_1", "param_map": {"name": "{{instance}}"}},
            secrets={"access_key_id": "ak", "access_key_secret": "sk"},
            apprise_url="",
        )
        from app.services.notification_providers import send_via_channel

        result = send_via_channel(
            channel,
            ProviderMessage(
                title="t",
                body="b",
                fields={"instance": "alpha"},
                recipients={"phone": ["13800138000"]},
            ),
        )
        self.assertTrue(result.success)
        params = get.call_args.kwargs["params"]
        self.assertEqual("13800138000", params["PhoneNumbers"])
        self.assertEqual("SMS_1", params["TemplateCode"])
        self.assertIn("Signature", params)
        self.assertEqual("2017-05-25", params["Version"])

    @patch("app.services.notification_providers.httpx.request")
    def test_webhook_delivery(self, request: MagicMock) -> None:
        request.return_value = MagicMock(status_code=200, headers={"x-request-id": "req-1"})
        from app.services.notification_providers import send_via_channel

        result = send_via_channel(
            MagicMock(
                id="hook",
                name="hook",
                type="webhook",
                config={"method": "POST"},
                secrets={"url": "https://example.com/hook"},
                apprise_url="",
            ),
            ProviderMessage(title="t", body="b", fields={"instance": "alpha"}),
        )
        self.assertTrue(result.success)
        self.assertEqual("req-1", result.provider_message_id)

    @patch("app.services.notification_providers.smtplib.SMTP")
    def test_smtp_delivery(self, smtp: MagicMock) -> None:
        client = smtp.return_value.__enter__.return_value
        from app.services.notification_providers import send_via_channel

        result = send_via_channel(
            MagicMock(
                id="mail",
                name="mail",
                type="smtp",
                config={
                    "host": "smtp.example.com",
                    "port": 587,
                    "security": "starttls",
                    "from_address": "ops@example.com",
                    "username": "ops@example.com",
                },
                secrets={"password": "pw"},
                apprise_url="",
            ),
            ProviderMessage(
                title="t",
                body="b",
                recipients={"email": ["oncall@example.com"]},
            ),
        )
        self.assertTrue(result.success)
        client.send_message.assert_called_once()


if __name__ == "__main__":
    unittest.main()
