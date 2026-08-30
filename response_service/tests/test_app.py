from __future__ import annotations

import json
import unittest
from pathlib import Path
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

    def test_stock_ocs_request_shape_is_accepted(self):
        result = {
            "question": "Which one?",
            "answer": "B",
            "confidence": 0.9,
            "model": "test-model",
            "warnings": [],
        }
        with patch("response_service.app.engine.answer", return_value=result) as answer:
            response = self.client.post(
                "/v1/answer",
                json={"title": "Which one?", "options": "first\nsecond", "type": "single"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "B")
        payload = answer.call_args.args[0]
        self.assertEqual(payload["title"], "Which one?")
        self.assertEqual(payload["options"], "first\nsecond")
        self.assertEqual(payload["type"], "single")

    def test_example_wrapper_only_uses_upstream_ocs_environment_fields(self):
        config_path = Path(__file__).parents[1] / "ocs-answerer-wrapper.json.example"
        wrapper = json.loads(config_path.read_text(encoding="utf-8"))[0]

        self.assertEqual(set(wrapper["data"]), {"title", "options", "type"})
        self.assertNotIn("option_items", config_path.read_text(encoding="utf-8"))
        self.assertEqual(wrapper["type"], "GM_xmlhttpRequest")


if __name__ == "__main__":
    unittest.main()
