import ast
import pathlib
import secrets
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi import HTTPException

tree = ast.parse(pathlib.Path(sys.argv.pop(1)).read_text(encoding="utf-8-sig"))
nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
         and n.name in {"get_pos_bridge_config", "require_pos_bridge_sync_key"}]
for node in nodes:
    node.decorator_list = []


class HealthTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.login = AsyncMock()
        self.scope = dict(Request=object, HTTPException=HTTPException, secrets=secrets,
                          ADMINCORE_API_KEY="test-key", POS_CORE_API_KEY="",
                          POS_CORE_API_BASE_URL="https://pos.invalid", POS_CORE_OWNER_EMAIL="",
                          POS_CORE_OWNER_PASSWORD="", get_current_user=self.login)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "health-functions", "exec"), self.scope)

    async def test_bridge_key_is_accepted_without_session(self):
        result = await self.scope["get_pos_bridge_config"](SimpleNamespace(headers={"x-admincore-api-key": "test-key"}))
        self.assertTrue(result["configured"])
        self.login.assert_not_awaited()

    async def test_invalid_key_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await self.scope["get_pos_bridge_config"](SimpleNamespace(headers={"x-admincore-api-key": "wrong"}))
        self.assertEqual(raised.exception.status_code, 401)

    async def test_browser_still_requires_session(self):
        await self.scope["get_pos_bridge_config"](SimpleNamespace(headers={}))
        self.login.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
