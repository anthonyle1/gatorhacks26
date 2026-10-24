import os
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import ConnectionFailure, PyMongoError

with patch.dict(os.environ, {"MONGODB_URI": "mongodb://localhost:27017"}):
    from app.main import app as backend_app, database_error_handler
    from app.services.analysis_jobs import process_video_analysis


class BackendErrorTests(unittest.TestCase):
    def test_database_dependent_failure_returns_sanitized_json(self):
        app = FastAPI()
        app.add_exception_handler(PyMongoError, database_error_handler)

        @app.get("/database-dependent")
        async def fail():
            raise ConnectionFailure("private database connection details")

        response = TestClient(app).get("/database-dependent")
        self.assertEqual(response.status_code, 503)
        self.assertIn("application/json", response.headers["content-type"])
        self.assertIn("Database unavailable", response.json()["detail"])
        self.assertNotIn("private", response.text)

    def test_health_returns_json_for_database_timeout_and_failure(self):
        for error in (TimeoutError(), ConnectionFailure("private details")):
            with self.subTest(error=type(error).__name__), \
                 patch("app.main.ping_database", new_callable=AsyncMock, side_effect=error):
                response = TestClient(backend_app).get("/health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {"detail": "Database unavailable"})

    def test_health_still_reports_a_working_database(self):
        with patch("app.main.ping_database", new_callable=AsyncMock):
            response = TestClient(backend_app).get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "connected")


class BackgroundJobErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_claim_and_failed_status_write_do_not_escape_background_task(self):
        collection = Mock()
        collection.find_one_and_update = AsyncMock(side_effect=ConnectionFailure("Database down"))
        collection.update_one = AsyncMock(side_effect=ConnectionFailure("Still down"))
        with patch("app.services.analysis_jobs.db") as database, \
             patch("app.services.analysis_jobs.get_analyzer") as analyzer:
            database.video_analyses = collection
            await process_video_analysis("abcdefghijk")
        collection.find_one_and_update.assert_awaited_once()
        collection.update_one.assert_awaited_once()
        analyzer.assert_not_called()
