"""Run against AdminCore's worker without starting its API or touching MongoDB.

Usage: python backend/scripts/admincore-worker-tests.py PATH_TO_ADMINCORE_BACKEND
"""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock

worker_path = pathlib.Path(sys.argv.pop(1)) / "pos_sync_worker.py"
sys.path.insert(0, str(worker_path.parent))
spec = importlib.util.spec_from_file_location("pos_sync_worker", worker_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SyncWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_snapshot_is_not_fresh_data(self):
        self.collection.find_one.return_value = {"status": "failed", "updated_at": module.timestamp()}
        self.collection.find_one_and_update.return_value = {"status": "pending"}
        result = await self.worker.enqueue_snapshot("orders", "business-1", fresh_for_seconds=60)
        self.assertEqual(result["status"], "pending")
        self.collection.find_one_and_update.assert_awaited_once()

    async def test_successful_recent_snapshot_is_reused(self):
        recent = {"status": "synced", "finished_at": module.timestamp()}
        self.collection.find_one.return_value = recent
        self.assertEqual(await self.worker.enqueue_snapshot("orders", "business-1", fresh_for_seconds=60), recent)
        self.collection.find_one_and_update.assert_not_awaited()

    def setUp(self):
        self.collection = AsyncMock()
        self.processor = AsyncMock(return_value={"status": "success", "error_count": 0})
        self.worker = module.PosSyncWorker(self.collection, self.processor)

    def claimed_job(self, attempts=1, max_attempts=5):
        self.collection.find_one_and_update.return_value = {
            "_id": "pos-change:event-1", "resource": "orders", "business_id": "business-1",
            "attempts": attempts, "max_attempts": max_attempts,
        }

    async def test_event_receipt_uses_stable_insert_only_identity(self):
        self.collection.find_one.return_value = {"business_id": "business-1", "resource": "orders"}
        await self.worker.enqueue("event-1", "orders", "business-1")
        query, update = self.collection.update_one.call_args.args
        self.assertEqual(query, {"_id": "pos-change:event-1"})
        self.assertEqual(set(update), {"$setOnInsert"})
        self.assertTrue(self.collection.update_one.call_args.kwargs["upsert"])

    async def test_event_cannot_be_reused_for_another_business(self):
        self.collection.find_one.return_value = {"business_id": "business-2", "resource": "orders"}
        with self.assertRaises(ValueError):
            await self.worker.enqueue("event-1", "orders", "business-1")

    async def test_idle_worker_does_not_import(self):
        self.collection.find_one_and_update.return_value = None
        self.assertIsNone(await self.worker.run_once())
        self.processor.assert_not_awaited()

    async def test_success_is_saved_only_by_current_lease(self):
        self.claimed_job()
        result = await self.worker.run_once()
        self.assertEqual(result["status"], "synced")
        self.processor.assert_awaited_once_with("orders", "business-1")
        claim = self.collection.find_one_and_update.call_args.args[1]["$set"]
        query, update = self.collection.update_one.call_args.args
        self.assertEqual(query["lease"], claim["lease"])
        self.assertEqual(set(update["$unset"]), {"lease", "lease_until"})

    async def test_partial_import_retries_with_exact_error(self):
        self.claimed_job()
        self.processor.return_value = {"status": "partial", "error_count": 1, "errors": ["Outlet missing"]}
        result = await self.worker.run_once()
        self.assertEqual(result["status"], "retrying")
        self.assertIn("Outlet missing", result["last_error"])

    async def test_final_failure_stops_retrying(self):
        self.claimed_job(attempts=5)
        self.processor.side_effect = RuntimeError("POS unavailable")
        result = await self.worker.run_once()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["last_error"], "POS unavailable")

    async def test_expired_final_attempt_does_not_import_again(self):
        self.claimed_job(attempts=6)
        result = await self.worker.run_once()
        self.assertEqual(result["status"], "failed")
        self.processor.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
