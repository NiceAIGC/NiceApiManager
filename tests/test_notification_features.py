from __future__ import annotations

from datetime import timedelta
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.time import utcnow
from app.models import AppSetting, Base, DailyUsageStat, Instance, NotificationLog, SyncRun, UserSnapshot
from app.schemas.app_setting import NotificationChannelConfig
from app.services import notification_service, sync_service
from app.services.instance_service import list_instances
from app.services.snapshot_metrics import current_day_start_utc


class NotificationFeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _add_default_channel(self, db) -> None:
        channel = NotificationChannelConfig(
            id="channel_default",
            name="Default",
            enabled=True,
            apprise_url="json://",
        )
        db.add(
            AppSetting(
                notification_enabled=False,
                notification_check_interval_minutes=5,
                default_balance_alert_threshold=60,
                default_notification_channel_id=channel.id,
                notification_channels_json=[channel.model_dump(mode="json")],
            )
        )

    def test_quick_balance_alert_runs_when_advanced_monitoring_is_disabled(self) -> None:
        with self.session_factory() as db:
            self._add_default_channel(db)
            instance = Instance(
                name="quick-alert",
                base_url="https://example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                balance_alert_enabled=True,
                billing_mode="prepaid",
                quota_per_unit=500_000,
                priority=3,
                sync_interval_minutes=120,
            )
            db.add(instance)
            db.flush()
            db.add(
                UserSnapshot(
                    instance_id=instance.id,
                    quota=25_000_000,
                    used_quota=10,
                    request_count=1,
                    snapshot_at=utcnow(),
                )
            )
            db.commit()

        with (
            patch.object(notification_service, "SessionLocal", self.session_factory),
            patch.object(notification_service, "_send_via_apprise", return_value=True),
        ):
            notification_service.run_notification_monitoring_pass()

        with self.session_factory() as db:
            logs = db.scalars(select(NotificationLog)).all()
            self.assertEqual(1, len(logs))
            self.assertEqual("instance_balance", logs[0].rule_type)
            self.assertEqual("alert", logs[0].event_type)
            self.assertEqual("channel_default", logs[0].channels_json[0]["channel_id"])

    def test_five_scheduled_failures_mark_instance_as_auto_disabled(self) -> None:
        with self.session_factory() as db:
            instance = Instance(
                name="unhealthy",
                base_url="https://example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=5,
            )
            db.add(instance)
            db.flush()
            for offset in range(5):
                started_at = utcnow() - timedelta(minutes=offset)
                db.add(
                    SyncRun(
                        instance_id=instance.id,
                        trigger_type="scheduled",
                        status="failed",
                        started_at=started_at,
                        finished_at=started_at,
                        error_message="unreachable",
                    )
                )
            db.commit()

            with patch.object(sync_service, "dispatch_instance_health_event", return_value=True) as dispatch:
                sync_service._disable_after_consecutive_scheduled_failures(db, instance, "scheduled")

            self.assertFalse(instance.enabled)
            self.assertTrue(instance.auto_disabled)
            dispatch.assert_called_once_with(
                db,
                instance=instance,
                event_type="alert",
                error_message=instance.last_health_error,
            )

    def test_scheduler_retries_auto_disabled_but_not_manually_disabled_instances(self) -> None:
        with self.session_factory() as db:
            auto_disabled = Instance(
                name="auto-disabled",
                base_url="https://auto.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=False,
                auto_disabled=True,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=5,
            )
            manually_disabled = Instance(
                name="manually-disabled",
                base_url="https://manual.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=False,
                auto_disabled=False,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=5,
            )
            db.add_all([auto_disabled, manually_disabled])
            db.commit()
            auto_disabled_id = auto_disabled.id

        with (
            patch.object(sync_service, "SessionLocal", self.session_factory),
            patch.object(sync_service, "_sync_instance_in_worker") as worker,
        ):
            worker.return_value.status = "success"
            sync_service.run_scheduled_sync_pass()

        worker.assert_called_once_with(auto_disabled_id, "auto-disabled", trigger_type="scheduled")

    def test_scheduler_respects_interval_and_runs_due_enabled_instances(self) -> None:
        with self.session_factory() as db:
            due = Instance(
                name="due",
                base_url="https://due.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=120,
                last_sync_at=utcnow() - timedelta(minutes=121),
            )
            not_due = Instance(
                name="not-due",
                base_url="https://not-due.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=120,
                last_sync_at=utcnow() - timedelta(minutes=119),
            )
            db.add_all([due, not_due])
            db.commit()
            due_id = due.id

        with (
            patch.object(sync_service, "SessionLocal", self.session_factory),
            patch.object(sync_service, "_sync_instance_in_worker") as worker,
        ):
            worker.return_value.status = "success"
            sync_service.run_scheduled_sync_pass()

        worker.assert_called_once_with(due_id, "due", trigger_type="scheduled")

    def test_instance_list_exposes_today_usage_amount(self) -> None:
        today = current_day_start_utc("Asia/Shanghai").date()
        with self.session_factory() as db:
            instance = Instance(
                name="today-usage",
                base_url="https://usage.example.com",
                program_type="newapi",
                username="user",
                password="password",
                enabled=True,
                billing_mode="prepaid",
                priority=3,
                sync_interval_minutes=120,
            )
            db.add(instance)
            db.flush()
            db.add(
                DailyUsageStat(
                    instance_id=instance.id,
                    usage_date=today,
                    request_count=12,
                    used_quota=625_000,
                    used_display_amount=1.25,
                    synced_at=utcnow(),
                )
            )
            db.commit()

            response = list_instances(db)

        self.assertEqual(1, response.total)
        self.assertEqual(1.25, response.items[0].today_display_used_amount)


if __name__ == "__main__":
    unittest.main()
