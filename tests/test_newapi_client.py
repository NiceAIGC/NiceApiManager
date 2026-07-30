from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import Mock

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.clients.newapi import NewAPIClient, NewAPIClientError, NewAPISessionData
from app.core.time import utcnow
from app.models import Base, Instance, InstanceSession
from app.services.sync_service import _ensure_session


class NewAPIClientLoginTests(unittest.TestCase):
    def _client_with_transport(self, handler) -> NewAPIClient:
        client = NewAPIClient("https://new-api.example")

        def build_client(
            remote_user_id: int | None = None,
            cookie_value: str | None = None,
            access_token: str | None = None,
            refresh_token: str | None = None,
        ) -> httpx.Client:
            headers = {}
            if remote_user_id is not None:
                headers["New-API-User"] = str(remote_user_id)
            if access_token:
                headers["Authorization"] = f"Bearer {access_token}"
            cookies = (
                {"new_api_refresh": refresh_token}
                if refresh_token
                else ({"session": cookie_value} if cookie_value else None)
            )
            return httpx.Client(
                base_url=client.base_url,
                transport=httpx.MockTransport(handler),
                headers=headers,
                cookies=cookies,
            )

        client._build_client = build_client
        return client

    def test_modern_login_uses_returned_bearer_token_and_nested_user(self) -> None:
        expires_at = 1_893_456_000
        authenticated_request: httpx.Request | None = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal authenticated_request
            if request.url.path == "/api/user/login":
                return httpx.Response(
                    200,
                    json={
                        "success": True,
                        "data": {
                            "access_token": "modern-access-token",
                            "token_type": "Bearer",
                            "access_expires_at": expires_at,
                            "session": {"sid": "remote-session"},
                            "user": {"id": 42, "username": "alice"},
                        },
                    },
                    headers={"set-cookie": "new_api_refresh=refresh-token; Path=/api/user/auth; HttpOnly"},
                )
            if request.url.path == "/api/user/self":
                authenticated_request = request
                return httpx.Response(200, json={"success": True, "data": {"id": 42}})
            raise AssertionError(f"Unexpected request: {request.url.path}")

        client = self._client_with_transport(handler)
        session = client.login("alice", "secret")
        profile = client.get_user_self(session.remote_user_id, session.cookie_value, session.access_token)

        self.assertEqual(42, session.remote_user_id)
        self.assertEqual("", session.cookie_value)
        self.assertEqual("modern-access-token", session.access_token)
        self.assertEqual("refresh-token", session.refresh_token)
        self.assertEqual(datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None), session.expires_at)
        self.assertEqual({"id": 42}, profile)
        self.assertIsNotNone(authenticated_request)
        self.assertEqual("Bearer modern-access-token", authenticated_request.headers["Authorization"])
        self.assertEqual("42", authenticated_request.headers["New-API-User"])

    def test_modern_refresh_rotates_tokens(self) -> None:
        expires_at = 1_893_456_000
        refresh_request: httpx.Request | None = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal refresh_request
            refresh_request = request
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {
                        "access_token": "rotated-access-token",
                        "access_expires_at": expires_at,
                        "user": {"id": 42},
                    },
                },
                headers={"set-cookie": "new_api_refresh=rotated-refresh-token; Path=/api/user/auth; HttpOnly"},
            )

        session = self._client_with_transport(handler).refresh(42, "old-refresh-token")

        self.assertEqual("rotated-access-token", session.access_token)
        self.assertEqual("", session.cookie_value)
        self.assertEqual("rotated-refresh-token", session.refresh_token)
        self.assertEqual(datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None), session.expires_at)
        self.assertIsNotNone(refresh_request)
        self.assertEqual("POST", refresh_request.method)
        self.assertEqual("/api/user/auth/refresh", refresh_request.url.path)
        self.assertEqual("https://new-api.example", refresh_request.headers["Origin"])
        self.assertIn("new_api_refresh=old-refresh-token", refresh_request.headers["Cookie"])

    def test_modern_login_falls_back_to_jwt_expiry(self) -> None:
        expires_at = 1_893_456_000
        encoded_payload = base64.urlsafe_b64encode(json.dumps({"exp": expires_at}).encode()).rstrip(b"=").decode()
        token = f"header.{encoded_payload}.signature"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {
                        "access_token": token,
                        "user": {"id": 42},
                    },
                },
            )

        session = self._client_with_transport(handler).login("alice", "secret")

        self.assertEqual(datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None), session.expires_at)

    def test_legacy_login_still_uses_session_cookie(self) -> None:
        authenticated_request: httpx.Request | None = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal authenticated_request
            if request.url.path == "/api/user/login":
                return httpx.Response(
                    200,
                    json={"success": True, "data": {"id": 7}},
                    headers={"set-cookie": "session=legacy-cookie; Path=/; Max-Age=3600"},
                )
            if request.url.path == "/api/user/self":
                authenticated_request = request
                return httpx.Response(200, json={"success": True, "data": {"id": 7}})
            raise AssertionError(f"Unexpected request: {request.url.path}")

        client = self._client_with_transport(handler)
        session = client.login("bob", "secret")
        client.get_user_self(session.remote_user_id, session.cookie_value, session.access_token)

        self.assertEqual(7, session.remote_user_id)
        self.assertEqual("legacy-cookie", session.cookie_value)
        self.assertIsNone(session.access_token)
        self.assertIsNotNone(session.expires_at)
        self.assertIsNotNone(authenticated_request)
        self.assertIn("session=legacy-cookie", authenticated_request.headers["Cookie"])

    def test_two_factor_login_reports_an_actionable_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {"require_2fa": True, "flow_token": "flow-token"},
                },
            )

        with self.assertRaisesRegex(NewAPIClientError, "两步验证"):
            self._client_with_transport(handler).login("alice", "secret")


class NewAPISessionRefreshTests(unittest.TestCase):
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

    def test_expired_modern_session_refreshes_without_password_login(self) -> None:
        with self.session_factory() as db:
            instance = Instance(
                name="modern-refresh",
                base_url="https://new-api.example",
                program_type="newapi",
                username="alice",
                password="secret",
            )
            db.add(instance)
            db.flush()
            db.add(
                InstanceSession(
                    instance_id=instance.id,
                    remote_user_id=42,
                    cookie_value="",
                    access_token="expired-access-token",
                    refresh_token="old-refresh-token",
                    expires_at=utcnow() - timedelta(seconds=1),
                )
            )
            db.commit()

            refreshed = NewAPISessionData(
                remote_user_id=42,
                cookie_value="",
                access_token="fresh-access-token",
                expires_at=utcnow() + timedelta(minutes=15),
                refresh_token="rotated-refresh-token",
            )
            client = Mock()
            client.refresh.return_value = refreshed

            result = _ensure_session(db, instance, client)
            stored = db.query(InstanceSession).filter_by(instance_id=instance.id).one()

            self.assertEqual("fresh-access-token", result.access_token)
            self.assertEqual("rotated-refresh-token", stored.refresh_token)
            self.assertEqual("fresh-access-token", stored.access_token)
            client.refresh.assert_called_once_with(42, "old-refresh-token")
            client.login.assert_not_called()

if __name__ == "__main__":
    unittest.main()
