from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from response_service.app import app


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_root_get_and_head_support_ocs_connectivity_probe(self):
        get_response = self.client.get("/")
        head_response = self.client.head("/")

        self.assertEqual(get_response.status_code, 200)
        self.assertTrue(get_response.json()["ok"])
        self.assertEqual(head_response.status_code, 200)

    def test_runtime_answer_error_is_returned_as_ocs_result(self):
        with patch("response_service.app.engine.answer", side_effect=RuntimeError("provider failed")):
            response = self.client.post("/v1/answer", json={"title": "test"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"code": 0, "message": "provider failed"})


if __name__ == "__main__":
    unittest.main()
