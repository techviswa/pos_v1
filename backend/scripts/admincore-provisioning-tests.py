"""Exercise actual server functions without importing its startup side effects."""
import ast
import pathlib
import sys
import unittest
from datetime import datetime, timezone
from typing import Optional
from types import SimpleNamespace
import logging
from unittest.mock import AsyncMock
from fastapi import HTTPException

source = pathlib.Path(sys.argv.pop(1)).read_text(encoding="utf-8-sig")
tree = ast.parse(source)
functions = ast.Module(body=[node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
    and node.name in {"provision_admin_business_to_pos", "push_admin_user_to_pos", "provision_business_to_pos_endpoint"}], type_ignores=[])
for function in functions.body:
    function.decorator_list = []


class ProvisioningTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = AsyncMock()
        self.db.businesses.find_one.return_value = {"id": "second", "name": "Restaurant"}
        self.request = AsyncMock(return_value={"data": {"business": {"id": "second", "tenant_id": "admincore-second"}}})
        self.outlet = AsyncMock(return_value={"id": "outlet"})
        self.scope = {"Optional": Optional, "HTTPException": HTTPException, "datetime": datetime,
            "BusinessProvisionRequest": object, "Request": object,
            "get_current_user": AsyncMock(return_value={"id": "admin", "role": "platform_admin"}),
            "validate_business_access": AsyncMock(), "ensure_business_owner_user": AsyncMock(),
            "queue_pos_provisioning_job": AsyncMock(return_value={"id": "job", "status": "pending"}),
            "sanitize_business_doc": lambda business: business,
            "timezone": timezone, "POS_CORE_API_BASE_URL": "https://pos.invalid", "db": self.db,
            "pos_core_session_request": self.request, "ensure_default_outlet_for_business": self.outlet,
            "pos_headers_for_admin_business": AsyncMock(return_value={}),
            "admin_role_to_pos_role": lambda role: role}
        exec(compile(functions, "server-functions", "exec"), self.scope)

    async def test_default_outlet_failure_reaches_provisioning_worker(self):
        outlet_function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                               and node.name == "ensure_default_outlet_for_business")
        self.scope.update({"logger": logging.getLogger("test"), "ObjectId": lambda: "new-outlet",
                           "make_outlet_code": lambda code: code,
                           "push_admin_outlet_to_pos": AsyncMock(side_effect=HTTPException(status_code=503, detail="POS unavailable"))})
        exec(compile(ast.Module(body=[outlet_function], type_ignores=[]), "outlet-function", "exec"), self.scope)
        for existing in [{"id": "existing"}, None]:
            with self.subTest(existing=bool(existing)):
                self.db.outlets.find_one.return_value = existing
                with self.assertLogs("test", level="WARNING"):
                    with self.assertRaises(HTTPException) as raised:
                        await self.scope["ensure_default_outlet_for_business"]("second")
                self.assertEqual(raised.exception.detail, "POS unavailable")

    async def test_manual_retry_queues_without_calling_pos(self):
        data = SimpleNamespace(owner_email="owner@example.test", owner_name="Owner", owner_password="test-password")
        result = await self.scope["provision_business_to_pos_endpoint"]("second", data, object())
        self.assertFalse(result["pos_provisioned"])
        self.assertEqual(result["pos_provisioning_job"]["id"], "job")
        self.scope["queue_pos_provisioning_job"].assert_awaited_once()
        self.request.assert_not_awaited()

    async def test_unconfigured_retry_does_not_queue(self):
        self.scope["POS_CORE_API_BASE_URL"] = ""
        with self.assertRaises(HTTPException) as raised:
            await self.scope["provision_business_to_pos_endpoint"]("second", object(), object())
        self.assertEqual(raised.exception.status_code, 503)
        self.scope["queue_pos_provisioning_job"].assert_not_awaited()

    async def test_unauthorized_retry_does_not_queue(self):
        self.scope["get_current_user"].return_value = {"role": "staff"}
        with self.assertRaises(HTTPException) as raised:
            await self.scope["provision_business_to_pos_endpoint"]("second", object(), object())
        self.assertEqual(raised.exception.status_code, 403)
        self.scope["queue_pos_provisioning_job"].assert_not_awaited()

    async def test_provisioning_uses_one_request_and_verified_identity(self):
        result = await self.scope["provision_admin_business_to_pos"]("second")
        self.assertEqual(result["business_id"], "second")
        self.request.assert_awaited_once()
        self.db.businesses.update_one.assert_awaited_once()

    async def test_wrong_tenant_does_not_save_mapping(self):
        self.request.return_value = {"data": {"business": {"id": "second", "tenant_id": "wrong"}}}
        with self.assertRaises(HTTPException):
            await self.scope["provision_admin_business_to_pos"]("second")
        self.db.businesses.update_one.assert_not_awaited()
        self.outlet.assert_not_awaited()

    async def test_failed_request_does_not_save_mapping(self):
        self.request.side_effect = HTTPException(status_code=503, detail="Backend unavailable")
        with self.assertRaises(HTTPException):
            await self.scope["provision_admin_business_to_pos"]("second")
        self.db.businesses.update_one.assert_not_awaited()

    async def test_owner_targets_second_business(self):
        self.request.return_value = {"data": {"id": "user", "business_id": "second", "tenant_id": "admincore-second"}}
        await self.scope["push_admin_user_to_pos"]({"id": "owner", "email": "owner@example.test",
            "role": "Owner", "business_ids": ["first", "second"]}, "test-password", target_business_id="second")
        self.scope["pos_headers_for_admin_business"].assert_awaited_once_with("second")
        self.assertEqual(self.request.call_args.kwargs["json"]["business_id"], "second")

    async def test_owner_cannot_target_unassigned_business(self):
        with self.assertRaises(HTTPException):
            await self.scope["push_admin_user_to_pos"]({"email": "owner@example.test",
                "business_ids": ["first"]}, "test-password", target_business_id="second")
        self.request.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
