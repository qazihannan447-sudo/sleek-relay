from __future__ import annotations

import unittest

from app.tts_markup import (
    TtsMarkupStream,
    apply_allowlisted_tts_markup,
    build_tts_name_allowlist,
)


class TtsMarkupTests(unittest.TestCase):
    def test_build_allowlist_dedupes_and_skips_short_names(self) -> None:
        names = build_tts_name_allowlist(
            business_name=" Greenleaf Dental ",
            agent_name="A",
        )
        self.assertEqual(names, ("Greenleaf Dental",))

        names = build_tts_name_allowlist(
            business_name="Greenleaf Dental",
            agent_name="greenleaf dental",
        )
        self.assertEqual(names, ("Greenleaf Dental",))

    def test_non_acronym_names_pass_through_unchanged(self) -> None:
        text = apply_allowlisted_tts_markup(
            "Welcome to Greenleaf Dental today.",
            ("Greenleaf Dental",),
        )
        self.assertEqual(text, "Welcome to Greenleaf Dental today.")

    def test_apply_spell_for_acronym_allowlist_names(self) -> None:
        text = apply_allowlisted_tts_markup("Call IBM for details.", ("IBM",))
        self.assertEqual(text, "Call <spell>IBM</spell> for details.")

    def test_does_not_double_spell(self) -> None:
        already = "Call <spell>IBM</spell> for details."
        text = apply_allowlisted_tts_markup(already, ("IBM",))
        self.assertEqual(text, already)

    def test_stream_passes_tokens_immediately_and_holds_acronym_prefix(self) -> None:
        stream = TtsMarkupStream(("IBM", "Greenleaf Dental"))
        self.assertEqual(stream.feed("Welcome to Greenleaf"), "Welcome to Greenleaf")
        self.assertEqual(stream.pending, "")
        self.assertEqual(stream.feed(" Dental. Call I"), " Dental. Call ")
        self.assertEqual(stream.pending, "I")
        self.assertEqual(stream.feed("BM please."), "<spell>IBM</spell> please.")
        self.assertEqual(stream.pending, "")
        self.assertEqual(stream.flush(), "")


if __name__ == "__main__":
    unittest.main()
