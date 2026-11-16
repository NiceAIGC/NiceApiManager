"""Delivery providers for the notification center.

Every provider receives a fully-resolved :class:`ProviderMessage` and returns a
:class:`ProviderResult`. Network/provider failures are converted into a result
instead of escaping into the sync scheduler.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import smtplib
import ssl
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

ALIYUN_SMS_ENDPOINT = "dysmsapi.aliyuncs.com"
ALIYUN_SMS_VERSION = "2017-05-25"
ALIYUN_VOICE_ENDPOINT = "dyvmsapi.aliyuncs.com"
ALIYUN_VOICE_VERSION = "2017-05-25"
ALIYUN_MAIL_ENDPOINT = "dm.aliyuncs.com"
ALIYUN_MAIL_VERSION = "2015-11-23"


@dataclass(frozen=True)
class ProviderMessage:
    """One message after contacts and templates have been resolved."""

    title: str
    body: str
    notify_type: str = "info"
    severity: str = "warning"
    fields: dict[str, str] = field(default_factory=dict)
    recipients: dict[str, list[str]] = field(default_factory=dict)
    template: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderResult:
    """Normalized delivery outcome shown in logs and test responses."""

    success: bool
    provider_message_id: str | None = None
    error_message: str | None = None
    latency_ms: int | None = None


def send_via_channel(channel: Any, message: ProviderMessage) -> ProviderResult:
    """Dispatch one channel through the provider matching ``channel.type``."""
    started = datetime.now(timezone.utc)
    try:
        channel_type = getattr(channel, "type", "apprise") or "apprise"
        if channel_type == "apprise":
            result = _send_apprise(channel, message)
        elif channel_type == "smtp":
            result = _send_smtp(channel, message)
        elif channel_type == "aliyun_sms":
            result = _send_aliyun_sms(channel, message)
        elif channel_type == "aliyun_voice":
            result = _send_aliyun_voice(channel, message)
        elif channel_type == "aliyun_directmail":
            result = _send_aliyun_directmail(channel, message)
        elif channel_type == "webhook":
            result = _send_webhook(channel, message)
        else:
            return ProviderResult(success=False, error_message=f"不支持的通知渠道类型：{channel_type}")
    except Exception as exc:  # pragma: no cover - provider/network dependent
        logger.warning("Notification delivery failed for channel %s: %s", getattr(channel, "id", "?"), exc)
        return ProviderResult(success=False, error_message=str(exc))
    latency = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    return ProviderResult(
        success=result.success,
        provider_message_id=result.provider_message_id,
        error_message=result.error_message,
        latency_ms=latency,
    )


def _channel_config(channel: Any) -> dict[str, Any]:
    config = getattr(channel, "config", None)
    return config if isinstance(config, dict) else {}


def _channel_secrets(channel: Any) -> dict[str, Any]:
    secrets = getattr(channel, "secrets", None)
    return secrets if isinstance(secrets, dict) else {}


def _recipients(channel: Any, message: ProviderMessage, kind: str) -> list[str]:
    config = _channel_config(channel)
    values = list(message.recipients.get(kind, []))
    values.extend(str(item) for item in config.get("recipients", []) if str(item).strip())
    unique: list[str] = []
    for item in values:
        value = str(item).strip()
        if value and value not in unique:
            unique.append(value)
    return unique


def _template_value(message: ProviderMessage, key: str, default: str = "") -> str:
    """Resolve a template variable from fields, then from common message keys."""
    if key in message.fields:
        return str(message.fields[key])
    if key == "title":
        return message.title
    if key == "body":
        return message.body
    if key == "severity":
        return message.severity
    if key == "time":
        return datetime.now(timezone.utc).isoformat()
    return default


def render_template(template: str, message: ProviderMessage) -> str:
    """Replace ``{{ variable }}`` placeholders without evaluating expressions."""
    result = template
    for key, value in message.fields.items():
        result = result.replace("{{" + key + "}}", str(value)).replace("{{ " + key + " }}", str(value))
    for key in ("title", "body", "severity", "time"):
        result = result.replace("{{" + key + "}}", _template_value(message, key)).replace(
            "{{ " + key + " }}", _template_value(message, key)
        )
    return result


def _provider_params(channel: Any, message: ProviderMessage) -> dict[str, str]:
    config = _channel_config(channel)
    template = message.template or {}
    mapping = config.get("param_map") or template.get("param_map") or {}
    if not isinstance(mapping, dict) or not mapping:
        return {key: str(value) for key, value in message.fields.items()}
    return {str(key): render_template(str(value), message) for key, value in mapping.items()}


def _provider_template_code(channel: Any, message: ProviderMessage) -> str:
    config = _channel_config(channel)
    template = message.template or {}
    return str(
        config.get("template_code")
        or config.get("tts_code")
        or template.get("provider_template_code")
        or ""
    ).strip()


def _send_apprise(channel: Any, message: ProviderMessage) -> ProviderResult:
    try:
        import apprise
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("Apprise 依赖未安装，请重新构建环境后再使用通知功能。") from exc

    url = str(
        _channel_secrets(channel).get("apprise_url")
        or getattr(channel, "apprise_url", "")
        or ""
    ).strip()
    if not url:
        return ProviderResult(success=False, error_message="Apprise URL 为空。")
    app = apprise.Apprise()
    if not app.add(url):
        return ProviderResult(success=False, error_message="无效的 Apprise URL。")
    notify_type_value = {
        "info": apprise.NotifyType.INFO,
        "warning": apprise.NotifyType.WARNING,
        "failure": apprise.NotifyType.FAILURE,
        "success": apprise.NotifyType.SUCCESS,
    }.get(message.notify_type, apprise.NotifyType.INFO)
    delivered = bool(app.notify(title=message.title, body=message.body, notify_type=notify_type_value))
    return ProviderResult(
        success=delivered,
        provider_message_id=str(uuid.uuid4()) if delivered else None,
        error_message=None if delivered else "Apprise 返回发送失败。",
    )


def _send_smtp(channel: Any, message: ProviderMessage) -> ProviderResult:
    config = _channel_config(channel)
    secrets = _channel_secrets(channel)
    recipients = _recipients(channel, message, "email")
    if not recipients:
        return ProviderResult(success=False, error_message="SMTP 渠道没有配置收件邮箱。")
    host = str(config.get("host", "")).strip()
    port = int(config.get("port") or 465)
    from_address = str(config.get("from_address", "")).strip()
    from_name = str(config.get("from_name") or "NiceApiManager").strip()
    username = str(config.get("username") or from_address).strip()
    password = str(secrets.get("password", ""))
    security = str(config.get("security") or ("ssl" if port == 465 else "starttls"))

    email_message = EmailMessage()
    email_message["Subject"] = render_template(str((message.template or {}).get("subject_template") or message.title), message)
    email_message["From"] = formataddr((from_name, from_address))
    email_message["To"] = ", ".join(recipients)
    body = render_template(str((message.template or {}).get("body_template") or message.body), message)
    email_message.set_content(body)
    if str(config.get("html", "")).lower() in {"1", "true", "yes"}:
        email_message.add_alternative(body, subtype="html")

    timeout = float(config.get("timeout") or 15)
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=ssl.create_default_context()) as client:
            if username and password:
                client.login(username, password)
            client.send_message(email_message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as client:
            client.ehlo()
            if security == "starttls":
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if username and password:
                client.login(username, password)
            client.send_message(email_message)
    return ProviderResult(success=True, provider_message_id=str(uuid.uuid4()))


def _send_aliyun_sms(channel: Any, message: ProviderMessage) -> ProviderResult:
    config = _channel_config(channel)
    secrets = _channel_secrets(channel)
    phones = _recipients(channel, message, "phone")
    if not phones:
        return ProviderResult(success=False, error_message="短信渠道没有配置接收手机号。")
    template_code = _provider_template_code(channel, message)
    if not template_code:
        return ProviderResult(success=False, error_message="短信渠道缺少模板 Code。")
    params = {
        "PhoneNumbers": ",".join(phones),
        "SignName": str(config.get("sign_name", "")).strip(),
        "TemplateCode": template_code,
        "TemplateParam": json.dumps(_provider_params(channel, message), ensure_ascii=False),
    }
    if config.get("sms_up_extend_code"):
        params["SmsUpExtendCode"] = str(config["sms_up_extend_code"])
    data = aliyun_rpc_call(
        access_key_id=str(secrets.get("access_key_id", "")),
        access_key_secret=str(secrets.get("access_key_secret", "")),
        endpoint=str(config.get("endpoint") or ALIYUN_SMS_ENDPOINT),
        action="SendSms",
        version=ALIYUN_SMS_VERSION,
        params=params,
    )
    if data.get("Code") != "OK":
        return ProviderResult(success=False, error_message=_aliyun_error(data))
    return ProviderResult(success=True, provider_message_id=data.get("BizId") or data.get("RequestId"))


def _send_aliyun_voice(channel: Any, message: ProviderMessage) -> ProviderResult:
    config = _channel_config(channel)
    secrets = _channel_secrets(channel)
    phones = _recipients(channel, message, "phone")
    if not phones:
        return ProviderResult(success=False, error_message="语音渠道没有配置接收手机号。")
    tts_code = _provider_template_code(channel, message)
    if not tts_code:
        return ProviderResult(success=False, error_message="语音渠道缺少 TTS 模板 Code。")
    last_result: ProviderResult | None = None
    for phone in phones:
        params = {
            "CalledNumber": phone,
            "TtsCode": tts_code,
            "TtsParam": json.dumps(_provider_params(channel, message), ensure_ascii=False),
            "PlayTimes": str(int(config.get("play_times") or 2)),
            "Volume": str(int(config.get("volume") or 100)),
            "Speed": str(int(config.get("speed") or 0)),
        }
        data = aliyun_rpc_call(
            access_key_id=str(secrets.get("access_key_id", "")),
            access_key_secret=str(secrets.get("access_key_secret", "")),
            endpoint=str(config.get("endpoint") or ALIYUN_VOICE_ENDPOINT),
            action="SingleCallByTts",
            version=ALIYUN_VOICE_VERSION,
            params=params,
        )
        if data.get("Code") != "OK":
            last_result = ProviderResult(success=False, error_message=_aliyun_error(data))
        else:
            last_result = ProviderResult(success=True, provider_message_id=data.get("CallId") or data.get("RequestId"))
    return last_result or ProviderResult(success=False, error_message="语音渠道没有可用接收人。")


def _send_aliyun_directmail(channel: Any, message: ProviderMessage) -> ProviderResult:
    config = _channel_config(channel)
    secrets = _channel_secrets(channel)
    recipients = _recipients(channel, message, "email")
    if not recipients:
        return ProviderResult(success=False, error_message="邮件渠道没有配置收件邮箱。")
    subject = render_template(str((message.template or {}).get("subject_template") or message.title), message)
    body = render_template(str((message.template or {}).get("body_template") or message.body), message)
    params = {
        "AccountName": str(config.get("account_name", "")).strip(),
        "AddressType": str(int(config.get("address_type") or 1)),
        "ReplyToAddress": "true" if config.get("reply_to_address", True) else "false",
        "ToAddress": ",".join(recipients),
        "Subject": subject,
        "HtmlBody": body if config.get("html", True) else "",
        "TextBody": "" if config.get("html", True) else body,
        "FromAlias": str(config.get("from_alias") or "NiceApiManager"),
    }
    data = aliyun_rpc_call(
        access_key_id=str(secrets.get("access_key_id", "")),
        access_key_secret=str(secrets.get("access_key_secret", "")),
        endpoint=str(config.get("endpoint") or ALIYUN_MAIL_ENDPOINT),
        action="SingleSendMail",
        version=ALIYUN_MAIL_VERSION,
        params=params,
    )
    if data.get("Code") not in (None, "OK"):
        return ProviderResult(success=False, error_message=_aliyun_error(data))
    return ProviderResult(success=True, provider_message_id=data.get("EnvId") or data.get("RequestId"))


def _send_webhook(channel: Any, message: ProviderMessage) -> ProviderResult:
    config = _channel_config(channel)
    secrets = _channel_secrets(channel)
    url = str(secrets.get("url") or config.get("url") or "").strip()
    if not url:
        return ProviderResult(success=False, error_message="Webhook URL 为空。")
    headers = {"Content-Type": "application/json", "User-Agent": "NiceApiManager/1.0"}
    for key, value in (config.get("headers") or {}).items():
        headers[str(key)] = render_template(str(value), message)
    payload = {
        "title": message.title,
        "body": message.body,
        "severity": message.severity,
        "notify_type": message.notify_type,
        "fields": message.fields,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    response = httpx.request(
        str(config.get("method") or "POST").upper(),
        url,
        headers=headers,
        json=payload,
        timeout=float(config.get("timeout") or 15),
    )
    response.raise_for_status()
    return ProviderResult(success=True, provider_message_id=response.headers.get("x-request-id"))


def _aliyun_error(data: dict[str, Any]) -> str:
    code = str(data.get("Code") or "ProviderError")
    message = str(data.get("Message") or "阿里云接口返回失败。")
    request_id = data.get("RequestId")
    return f"{code}: {message}" + (f"（RequestId: {request_id}）" if request_id else "")


def _percent_encode(value: str) -> str:
    """RFC 3986 encoding required by Aliyun RPC signatures."""
    return quote(str(value), safe="~")


def aliyun_rpc_call(
    *,
    access_key_id: str,
    access_key_secret: str,
    endpoint: str,
    action: str,
    version: str,
    params: dict[str, str],
    timeout: float = 15,
) -> dict[str, Any]:
    """Call one Aliyun RPC API with HMAC-SHA1 signature v1."""
    if not access_key_id or not access_key_secret:
        raise ValueError("阿里云 AccessKey 未配置。")
    common = {
        "AccessKeyId": access_key_id,
        "Action": action,
        "Format": "JSON",
        "RegionId": params.pop("RegionId", "cn-hangzhou"),
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": uuid.uuid4().hex,
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": version,
    }
    all_params = {**common, **{key: value for key, value in params.items() if value is not None}}
    canonical = "&".join(
        f"{_percent_encode(key)}={_percent_encode(value)}"
        for key, value in sorted(all_params.items())
    )
    string_to_sign = f"GET&%2F&{_percent_encode(canonical)}"
    digest = hmac.new(
        f"{access_key_secret}&".encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    all_params["Signature"] = base64.b64encode(digest).decode("utf-8")
    response = httpx.get(f"https://{endpoint}/", params=all_params, timeout=timeout)
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"阿里云接口返回非 JSON 响应（HTTP {response.status_code}）。") from exc
    if response.status_code >= 500:
        raise RuntimeError(_aliyun_error(data) if isinstance(data, dict) else f"HTTP {response.status_code}")
    return data if isinstance(data, dict) else {"Code": "InvalidResponse", "Message": str(data)}
