from __future__ import annotations

import unittest

from app.prompt import SYSTEM_PROMPT


class SystemPromptHumanizationTests(unittest.TestCase):
    def test_spoken_text_contract_follows_cartesia_natural_text_guidance(self) -> None:
        self.assertIn(
            "Write numbers, dates, times, phone numbers, email addresses, and common acronyms in normal written form",
            SYSTEM_PROMPT,
        )
        self.assertIn("End every spoken turn with ., ?, or !", SYSTEM_PROMPT)
        self.assertIn(
            "Use punctuation for meaning, not as a manual timing control",
            SYSTEM_PROMPT,
        )
        self.assertIn(
            "Usually answer in one to three short spoken sentences",
            SYSTEM_PROMPT,
        )
        self.assertIn(
            "Respond to the caller's actual last thought before adding any extra information",
            SYSTEM_PROMPT,
        )
        self.assertNotIn("Use soft commas for brief pauses", SYSTEM_PROMPT)
        self.assertNotIn(
            "Use plain punctuation only (commas, periods, question marks)",
            SYSTEM_PROMPT,
        )
        self.assertNotIn(
            "Speak numbers the way a person would on a call",
            SYSTEM_PROMPT,
        )


if __name__ == "__main__":
    unittest.main()
