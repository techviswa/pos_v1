import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(pathlib.Path(sys.argv.pop(1))))
from default_outlet import create_default_outlet_once


class DefaultOutletTests(unittest.IsolatedAsyncioTestCase):
    async def test_insert_uses_stable_key_and_insert_only_fields(self):
        document = {"id": "new", "business_id": "a", "name": "Main"}
        collection = SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(upserted_id="default-outlet:a")),
                                     find_one=AsyncMock(return_value=document))
        saved, created = await create_default_outlet_once(collection, document)
        self.assertTrue(created)
        self.assertEqual(saved, document)
        self.assertEqual(collection.update_one.call_args.args, ({"_id": "default-outlet:a"}, {"$setOnInsert": document}))

    async def test_concurrent_loser_reuses_winner_without_overwriting(self):
        winner = {"id": "winner", "business_id": "a", "name": "Renamed outlet"}
        for outcome in [None, DuplicateKeyError("concurrent insert")]:
            collection = SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(upserted_id=None), side_effect=outcome),
                                         find_one=AsyncMock(return_value=winner))
            saved, created = await create_default_outlet_once(collection, {"id": "loser", "business_id": "a"})
            self.assertFalse(created)
            self.assertEqual(saved, winner)

    async def test_unrelated_duplicate_error_is_not_swallowed(self):
        collection = SimpleNamespace(update_one=AsyncMock(side_effect=DuplicateKeyError("other unique key")), find_one=AsyncMock(return_value=None))
        with self.assertRaises(RuntimeError):
            await create_default_outlet_once(collection, {"business_id": "a"})

    async def test_wrong_tenant_document_is_rejected(self):
        collection = SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(upserted_id=None)),
                                     find_one=AsyncMock(return_value={"business_id": "b"}))
        with self.assertRaises(RuntimeError):
            await create_default_outlet_once(collection, {"business_id": "a"})


if __name__ == "__main__":
    unittest.main()
