from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from response_service.config import Settings


class SettingsTests(unittest.TestCase):
    def test_sol_xhigh_defaults_use_long_running_timeouts(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_env()

        self.assertEqual(settings.reasoning_effort, "xhigh")
        self.assertEqual(settings.request_timeout_seconds, 600.0)
        self.assertEqual(settings.image_timeout_seconds, 30.0)

    def test_invalid_effort_falls_back_to_xhigh(self):
        with patch.dict(os.environ, {"OPENAI_REASONING_EFFORT": "invalid"}, clear=True):
            settings = Settings.from_env()

        self.assertEqual(settings.reasoning_effort, "xhigh")


if __name__ == "__main__":
    unittest.main()
