"""Tests for tiered pricing storage, Sub2API mapping, labels, and comparisons."""

from __future__ import annotations

import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.clients import sub2api as sub2api_client
from app.clients.sub2api import Sub2APIClient, Sub2APISessionData, _pricing_from_plaza
from app.models import Base, GroupRatio, Instance, PricingModel
from app.services.billing_expr import parse_billing_expr
from app.services.group_service import (
    compare_group_ratios,
    create_group_label,
    list_group_labels,
    list_group_ratios,
)
from app.services.pricing_service import compare_pricing_models, list_pricing_models
from app.services.sync_service import _replace_group_ratios, _replace_pricing_models


def _make_db() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _add_instance(db: Session, name: str, program: str = "newapi", quota_per_unit: float | None = None, tags: list[str] | None = None) -> Instance:
    instance = Instance(
        name=name,
        base_url="https://example.com",
        program_type=program,
        password="x",
        quota_per_unit=quota_per_unit,
        tags_json=tags,
    )
    db.add(instance)
    db.commit()
    return instance


TIERED_EXPR = (
    'len <= 272000 ? tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5)'
    ' : tier("long_context", p * 20 + c * 75 + cr * 2 + cc * 25)'
)


class BillingExprParserTests(unittest.TestCase):
    def test_flat_expression_prices(self) -> None:
        parsed = parse_billing_expr('tier("base", p * 2.5 + c * 15 + cr * 0.25)')
        self.assertIsNotNone(parsed)
        tier = parsed["tiers"][0]
        self.assertEqual("base", tier["label"])
        self.assertEqual(2.5, tier["prices"]["input"])
        self.assertEqual(15.0, tier["prices"]["output"])
        self.assertEqual(0.25, tier["prices"]["cache_read"])

    def test_context_tiers_with_inverted_conditions(self) -> None:
        parsed = parse_billing_expr(TIERED_EXPR)
        labels = [tier["label"] for tier in parsed["tiers"]]
        self.assertEqual(["standard", "long_context"], labels)
        self.assertEqual({"var": "len", "op": "<=", "value": 272000.0}, parsed["tiers"][0]["conditions"][0])
        self.assertEqual({"var": "len", "op": ">", "value": 272000.0}, parsed["tiers"][1]["conditions"][0])
        self.assertEqual(20.0, parsed["tiers"][1]["prices"]["input"])

    def test_peak_windows(self) -> None:
        expr = (
            'weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && '
            '((hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12) || '
            '(hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18)) '
            '? tier("peak", p * 0.3 + c * 1.2) : tier("off_peak", p * 0.15 + c * 0.6)'
        )
        parsed = parse_billing_expr(expr)
        peak = parsed["tiers"][0]
        self.assertTrue(peak["weekdays_only"])
        self.assertEqual(
            [
                {"timezone": "Asia/Shanghai", "from_hour": 9, "to_hour": 12},
                {"timezone": "Asia/Shanghai", "from_hour": 14, "to_hour": 18},
            ],
            peak["time_windows"],
        )
        off_peak = parsed["tiers"][1]
        self.assertEqual([], off_peak["time_windows"])

    def test_fixed_request_price(self) -> None:
        parsed = parse_billing_expr('tier("request", fixed(0.00075))')
        self.assertEqual(0.00075, parsed["tiers"][0]["fixed_price"])

    def test_v1_prefix_and_request_rules(self) -> None:
        parsed = parse_billing_expr(
            'v1:tier("base", p * 2.5 + c * 15)|||when(header("x") has "y") * 6'
        )
        self.assertEqual(1, parsed["tier_count"])
        self.assertEqual('when(header("x") has "y") * 6', parsed["request_rules"])

    def test_unparseable_returns_none(self) -> None:
        self.assertIsNone(parse_billing_expr(None))
        self.assertIsNone(parse_billing_expr("p * 2 + c * 3"))


class PricingStorageTests(unittest.TestCase):
    def test_newapi_ratio_row_normalizes_to_usd_per_million(self) -> None:
        db = _make_db()
        instance = _add_instance(db, "newapi-a", quota_per_unit=500_000.0)
        payload = {
            "data": [
                {
                    "model_name": "gpt-x",
                    "quota_type": 0,
                    "model_ratio": 1.5,
                    "completion_ratio": 4,
                    "cache_ratio": 0.5,
                    "enable_groups": ["default", "vip"],
                }
            ],
            "vendors": [],
        }
        _replace_pricing_models(db, instance.id, payload, None, quota_per_unit=instance.quota_per_unit)
        db.commit()
        row = db.scalars(select(PricingModel)).one()
        self.assertEqual(1.5 * 1_000_000 / 500_000, row.price_input)
        self.assertEqual(row.price_input * 4, row.price_output)
        self.assertEqual(row.price_input * 0.5, row.price_cache_read)

    def test_newapi_tiered_row_stores_parsed_tiers(self) -> None:
        db = _make_db()
        instance = _add_instance(db, "newapi-b", quota_per_unit=500_000.0)
        payload = {
            "data": [
                {
                    "model_name": "gpt-6-astra",
                    "quota_type": 0,
                    "model_ratio": 0,
                    "completion_ratio": 0,
                    "billing_mode": "tiered_expr",
                    "billing_expr": TIERED_EXPR,
                    "enable_groups": ["default"],
                }
            ]
        }
        _replace_pricing_models(db, instance.id, payload, None, quota_per_unit=500_000.0)
        db.commit()
        row = db.scalars(select(PricingModel)).one()
        self.assertEqual(TIERED_EXPR, row.billing_expr)
        self.assertEqual(2, len(row.tiers_json))
        # Expression coefficients are USD per 1M directly — no conversion.
        self.assertEqual(10.0, row.price_input)
        self.assertEqual(50.0, row.price_output)
        self.assertEqual(1.0, row.price_cache_read)
        self.assertEqual(12.5, row.price_cache_write)

    def test_newapi_fixed_price_row(self) -> None:
        db = _make_db()
        instance = _add_instance(db, "newapi-c", quota_per_unit=500_000.0)
        payload = {
            "data": [
                {
                    "model_name": "dall-e",
                    "quota_type": 1,
                    "model_ratio": 0,
                    "model_price": 0.04,
                    "completion_ratio": 0,
                }
            ]
        }
        _replace_pricing_models(db, instance.id, payload, None)
        db.commit()
        row = db.scalars(select(PricingModel)).one()
        self.assertEqual(0.04, row.price_per_request)
        self.assertIsNone(row.price_input)


class Sub2APIClientTests(unittest.TestCase):
    def _client(self, handler) -> Sub2APIClient:
        import httpx

        client = Sub2APIClient("https://sub.example")

        def wrapped(request: httpx.Request) -> httpx.Response:
            result = handler(request)
            if isinstance(result, httpx.Response):
                return result
            return httpx.Response(200, json=result)

        def build_client(access_token: str | None = None) -> httpx.Client:
            headers = {}
            if access_token:
                headers["Authorization"] = f"Bearer {access_token}"
            return httpx.Client(
                base_url=client.base_url,
                transport=httpx.MockTransport(wrapped),
                headers=headers,
            )

        client._build_client = build_client
        return client

    def test_user_self_uses_micro_usd_and_actual_cost(self) -> None:
        def handler(request):
            if request.url.path == "/api/v1/user/profile":
                return {
                    "success": True,
                    "data": {"id": 7, "username": "bob@example.com", "balance": 12.34, "frozen_balance": 0.5},
                }
            if request.url.path == "/api/v1/auth/me":
                return {"success": True, "data": {"id": 7}}
            if request.url.path == "/api/v1/usage/dashboard/stats":
                return {
                    "success": True,
                    "data": {"total_requests": 88, "total_cost": 3.5, "total_actual_cost": 3.2},
                }
            if request.url.path == "/api/v1/usage/stats":
                return {"success": True, "data": {}}
            raise AssertionError(request.url.path)

        session = Sub2APISessionData(remote_user_id=7, access_token="tok", expires_at=None)
        data = self._client(handler).get_user_self(session)
        self.assertEqual(int(round(12.34 * 1_000_000)), data["quota"])
        self.assertEqual(int(round(3.2 * 1_000_000)), data["used_quota"])
        self.assertEqual(88, data["request_count"])
        self.assertEqual(0.5, data["frozen_balance_usd"])

    def test_plaza_pricing_normalizes_prices(self) -> None:
        plaza = {
            "success": True,
            "data": {
                "groups": [
                    {
                        "id": 1,
                        "name": "standard",
                        "description": "标准分组",
                        "platform": "anthropic",
                        "rate_multiplier": 1.5,
                        "user_rate_multiplier": 1.2,
                        "peak_rate_enabled": True,
                        "peak_start": "09:00:00",
                        "peak_end": "18:00:00",
                        "peak_rate_multiplier": 1.25,
                        "long_context_pricing_enabled": True,
                        "models": [
                            {
                                "name": "claude-x",
                                "platform": "anthropic",
                                "pricing": {
                                    "billing_mode": "token",
                                    "input_price": 3e-6,
                                    "output_price": 15e-6,
                                    "cache_read_price": 0.3e-6,
                                    "cache_write_price": 3.75e-6,
                                    "intervals": [
                                        {
                                            "min_tokens": 0,
                                            "max_tokens": 200000,
                                            "tier_label": "standard",
                                            "input_price": 3e-6,
                                            "output_price": 15e-6,
                                        },
                                        {
                                            "min_tokens": 200000,
                                            "max_tokens": None,
                                            "tier_label": "long",
                                            "input_price": 6e-6,
                                            "output_price": 22.5e-6,
                                        },
                                    ],
                                },
                                "official_pricing": {"input_price": 3e-6, "output_price": 15e-6},
                                "long_context_basis": "whole_request",
                                "time_pricing": {
                                    "timezone": "Asia/Shanghai",
                                    "weekdays_only": True,
                                    "periods": [{"start_time": "20:00", "end_time": "23:00", "multiplier": 0.8}],
                                },
                            }
                        ],
                    }
                ]
            },
        }
        rows, groups = _pricing_from_plaza(plaza)
        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("claude-x", row["model_name"])
        self.assertEqual(3.0, row["price_input"])
        self.assertEqual(15.0, row["price_output"])
        self.assertEqual(0.3, row["price_cache_read"])
        self.assertEqual(2, len(row["tiers"]))
        self.assertEqual(["standard"], row["enable_groups"])
        self.assertEqual(0.8, row["time_pricing"]["periods"][0]["multiplier"])
        self.assertEqual(1.5, groups["standard"]["ratio"])
        self.assertEqual(1.2, groups["standard"]["user_ratio"])
        self.assertEqual(1.25, groups["standard"]["peak_ratio"])
        self.assertEqual("09:00:00", groups["standard"]["peak_start"])

    def test_trend_rows_use_actual_cost(self) -> None:
        def handler(request):
            self.assertIn("timezone=Asia%2FShanghai", str(request.url))
            self.assertIn("start_date=", str(request.url))
            return {
                "success": True,
                "data": {
                    "trend": [
                        {"date": "2026-10-19", "requests": 10, "cost": 1.5, "actual_cost": 1.2},
                        {"date": "2026-10-20", "requests": 5, "cost": 0.5, "actual_cost": 0.4},
                    ]
                },
            }

        session = Sub2APISessionData(remote_user_id=7, access_token="tok", expires_at=None)
        rows = self._client(handler).get_daily_usage(
            session,
            start_timestamp=1_761_000_000,
            end_timestamp=1_761_086_400,
            timezone_name="Asia/Shanghai",
        )
        self.assertEqual(int(round(1.2 * 1_000_000)), rows[0]["quota"])
        self.assertEqual(10, rows[0]["count"])
        self.assertEqual(int(round(0.4 * 1_000_000)), rows[1]["quota"])


class GroupLabelAndCompareTests(unittest.TestCase):
    def _seed(self) -> Session:
        db = _make_db()
        a = _add_instance(db, "site-a", tags=["group-1"])
        b = _add_instance(db, "site-b", tags=["group-1"])
        _replace_group_ratios(
            db,
            a.id,
            {
                "vip": {"desc": "A vip", "ratio": 1.2},
                "default": {"desc": None, "ratio": 1.0},
            },
            None,
        )
        _replace_group_ratios(
            db,
            b.id,
            {
                "vip": {"desc": "B vip", "ratio": 0.8, "platform": "anthropic", "user_ratio": 0.9, "peak_ratio": 1.25, "peak_start": "09:00:00", "peak_end": "18:00:00"},
                "default": {"desc": None, "ratio": 1.0},
            },
            None,
        )
        db.commit()
        return db

    def test_labels_crud_and_filtering(self) -> None:
        db = self._seed()
        created = create_group_label(db, "高倍率组", None, "对比用", ["vip", "default"])
        self.assertEqual(["default", "vip"], created.group_names)

        labels = list_group_labels(db)
        self.assertEqual(1, labels.total)
        self.assertEqual("高倍率组", labels.items[0].name)

        ratios = list_group_ratios(db, label_id=created.id)
        self.assertEqual(4, ratios.total)
        for item in ratios.items:
            self.assertEqual(["高倍率组"], item.labels)

        vip_rows = [item for item in ratios.items if item.group_name == "vip"]
        by_instance = {item.instance_name: item for item in vip_rows}
        self.assertEqual(0.9, by_instance["site-b"].user_ratio)
        self.assertEqual(1.25, by_instance["site-b"].peak_ratio)
        self.assertEqual("anthropic", by_instance["site-b"].platform)

    def test_compare_across_instances(self) -> None:
        db = self._seed()
        create_group_label(db, "高倍率组", None, None, ["vip", "default"])
        label = list_group_labels(db).items[0]

        result = compare_group_ratios(db, label_id=label.id)
        by_name = {row.group_name: row for row in result.rows}
        self.assertEqual(0.8, by_name["vip"].min_ratio)
        self.assertEqual(1.2, by_name["vip"].max_ratio)
        self.assertAlmostEqual(0.4, by_name["vip"].spread)
        best = next(entry for entry in by_name["vip"].entries if entry.instance_name == "site-b")
        self.assertEqual(by_name["vip"].best_instance_id, best.instance_id)


class PricingCompareTests(unittest.TestCase):
    def test_compare_models_across_programs(self) -> None:
        db = _make_db()
        newapi = _add_instance(db, "newapi-site", quota_per_unit=500_000.0)
        sub2api = _add_instance(db, "sub-site", program="sub2api", quota_per_unit=1_000_000.0)

        _replace_group_ratios(
            db,
            newapi.id,
            {"default": {"desc": None, "ratio": 1.0}, "vip": {"desc": None, "ratio": 0.5}},
            None,
        )
        db.commit()
        _replace_pricing_models(
            db,
            newapi.id,
            {
                "data": [
                    {
                        "model_name": "model-x",
                        "quota_type": 0,
                        "model_ratio": 1.25,  # $2.5/1M input
                        "completion_ratio": 4,
                        "enable_groups": ["default", "vip"],
                    }
                ]
            },
            None,
            quota_per_unit=500_000.0,
        )
        _replace_pricing_models(
            db,
            sub2api.id,
            {
                "data": [
                    {
                        "model_name": "model-x",
                        "quota_type": 0,
                        "price_input": 2.0,
                        "price_output": 8.0,
                        "enable_groups": ["standard"],
                    }
                ]
            },
            None,
            quota_per_unit=1_000_000.0,
            program="sub2api",
        )
        db.commit()

        result = compare_pricing_models(db, search="model-x")
        self.assertEqual(1, result.total)
        row = result.models[0]
        entries = {entry.instance_id: entry for entry in row.entries}
        # NewAPI effective input = $2.5 * min group ratio 0.5 = $1.25/1M.
        self.assertAlmostEqual(1.25, entries[newapi.id].effective_input)
        # Sub2API base price has no group multiplier baked in.
        self.assertEqual(2.0, entries[sub2api.id].price_input)
        # NewAPI's cheapest reachable input ($1.25) beats Sub2API's base $2.0.
        self.assertEqual(newapi.id, row.best_instance_id)

    def test_billing_kind_filters(self) -> None:
        db = _make_db()
        instance = _add_instance(db, "newapi-f", quota_per_unit=500_000.0)
        _replace_pricing_models(
            db,
            instance.id,
            {
                "data": [
                    {"model_name": "plain", "quota_type": 0, "model_ratio": 1, "completion_ratio": 2},
                    {"model_name": "tiered", "quota_type": 0, "model_ratio": 0, "billing_mode": "tiered_expr", "billing_expr": TIERED_EXPR},
                    {"model_name": "fixed", "quota_type": 1, "model_price": 0.02},
                ]
            },
            None,
        )
        db.commit()

        token_rows = list_pricing_models(db, billing_kind="token")
        self.assertEqual(["plain"], [item.model_name for item in token_rows.items])
        tiered_rows = list_pricing_models(db, billing_kind="tiered")
        self.assertEqual(["tiered"], [item.model_name for item in tiered_rows.items])
        fixed_rows = list_pricing_models(db, billing_kind="fixed")
        self.assertEqual(["fixed"], [item.model_name for item in fixed_rows.items])


if __name__ == "__main__":
    unittest.main()
