"""Tests for applying one partial update to multiple instances."""

from __future__ import annotations

import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Instance
from app.schemas.instance import BatchInstanceBulkUpdateRequest
from app.services.instance_service import bulk_update_instances


class BulkInstanceUpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        self.engine = engine

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _add_instance(self, db: Session, name: str) -> Instance:
        instance = Instance(
            name=name,
            base_url="https://example.com",
            program_type="newapi",
            username="user",
            password="password",
            enabled=True,
            balance_alert_enabled=False,
            balance_alert_threshold=50,
            notify_rate_changes=True,
            notify_announcements=False,
            health_alert_enabled=False,
            priority=3,
            sync_interval_minutes=120,
            tags_json=["old"],
        )
        db.add(instance)
        db.commit()
        return instance

    def test_only_fields_present_in_payload_are_applied(self) -> None:
        with self.session_factory() as db:
            first = self._add_instance(db, "first")
            second = self._add_instance(db, "second")
            ids = [first.id, second.id]

            payload = BatchInstanceBulkUpdateRequest(
                ids=ids,
                balance_alert_enabled=True,
                balance_alert_threshold=None,
                notify_rate_changes=False,
                tags=["主力", "主力", "备用"],
            )
            result = bulk_update_instances(db, payload)

            self.assertEqual(2, result.count)
            rows = db.scalars(select(Instance).order_by(Instance.id)).all()
            for row in rows:
                self.assertTrue(row.balance_alert_enabled)
                self.assertIsNone(row.balance_alert_threshold)
                self.assertFalse(row.notify_rate_changes)
                self.assertFalse(row.notify_announcements)  # untouched
                self.assertEqual(3, row.priority)  # untouched
                self.assertEqual(["主力", "备用"], row.tags_json)

    def test_threshold_is_kept_when_field_is_omitted(self) -> None:
        with self.session_factory() as db:
            instance = self._add_instance(db, "threshold-kept")

            bulk_update_instances(
                db,
                BatchInstanceBulkUpdateRequest(ids=[instance.id], notify_announcements=True),
            )

            db.refresh(instance)
            self.assertEqual(50, instance.balance_alert_threshold)

    def test_disabling_clears_auto_disabled_flag(self) -> None:
        with self.session_factory() as db:
            instance = self._add_instance(db, "auto-disabled")
            instance.auto_disabled = True
            db.commit()

            bulk_update_instances(db, BatchInstanceBulkUpdateRequest(ids=[instance.id], enabled=False))

            db.refresh(instance)
            self.assertFalse(instance.enabled)
            self.assertFalse(instance.auto_disabled)

    def test_unknown_instance_returns_404_without_partial_write(self) -> None:
        with self.session_factory() as db:
            instance = self._add_instance(db, "existing")

            with self.assertRaises(HTTPException) as raised:
                bulk_update_instances(
                    db,
                    BatchInstanceBulkUpdateRequest(ids=[instance.id, 99999], notify_rate_changes=False),
                )
            self.assertEqual(404, raised.exception.status_code)
            db.rollback()
            db.refresh(instance)
            self.assertTrue(instance.notify_rate_changes)

    def test_payload_requires_at_least_one_change(self) -> None:
        with self.assertRaises(ValidationError):
            BatchInstanceBulkUpdateRequest(ids=[1])


if __name__ == "__main__":
    unittest.main()
