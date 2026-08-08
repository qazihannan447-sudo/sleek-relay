"""Allowlisted Cartesia SSML markup for known acronym business names.

LLM output stays plain text. Only short allowlisted acronyms receive ``<spell>``
tags. Markup is applied with a small rolling prefix hold so TOKEN streaming
cannot split a tag mid-name — without sentence-level buffering that fights
Cartesia managed prosody buffering.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

_ACRONYM_PATTERN = re.compile(r"^[A-Z]{2,6}(?:'[A-Z])?$")


def build_tts_name_allowlist(
    *,
    business_name: str | None = None,
    agent_name: str | None = None,
) -> tuple[str, ...]:
    """Return unique spoken names safe to mark up for Cartesia."""
    names: list[str] = []
    for raw in (business_name, agent_name):
        value = (raw or "").strip()
        if len(value) < 2:
            continue
        if any(value.casefold() == existing.casefold() for existing in names):
            continue
        names.append(value)
    return tuple(names)


def apply_allowlisted_tts_markup(text: str, names: Sequence[str]) -> str:
    """Wrap allowlisted acronym names in Cartesia ``<spell>`` tags."""
    if not text or not names:
        return text

    result = text
    for name in sorted(names, key=len, reverse=True):
        if not _looks_like_acronym(name):
            continue
        pattern = re.compile(
            rf"(?<![\w>])({re.escape(name)})(?![\w<])",
            re.IGNORECASE,
        )

        def _replace(match: re.Match[str]) -> str:
            matched = match.group(1)
            start = match.start()
            preceding = result[:start]
            if preceding.lower().endswith("<spell>"):
                return matched
            return f"<spell>{matched}</spell>"

        result = pattern.sub(_replace, result)

    return result


def _looks_like_acronym(name: str) -> bool:
    return bool(_ACRONYM_PATTERN.fullmatch(name.strip()))


class TtsMarkupStream:
    """Pass-through stream with a short hold for incomplete acronym prefixes."""

    def __init__(self, names: Sequence[str]) -> None:
        self._names = tuple(name for name in names if _looks_like_acronym(name))
        self._hold = ""
        self._max_hold = max((len(name) for name in self._names), default=0)

    @property
    def pending(self) -> str:
        return self._hold

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        if not self._names:
            return self._hold + chunk if self._hold else chunk

        text = f"{self._hold}{chunk}"
        self._hold = ""
        marked = apply_allowlisted_tts_markup(text, self._names)
        hold_len = self._incomplete_acronym_suffix_len(marked)
        if hold_len:
            self._hold = marked[-hold_len:]
            return marked[:-hold_len]
        return marked

    def flush(self) -> str:
        if not self._hold:
            return ""
        pending = self._hold
        self._hold = ""
        return apply_allowlisted_tts_markup(pending, self._names)

    def _incomplete_acronym_suffix_len(self, text: str) -> int:
        if not text or self._max_hold <= 0:
            return 0
        # Never hold inside an open/closed spell tag tail.
        lower = text.lower()
        if lower.endswith("</spell>") or lower.endswith("<spell>"):
            return 0
        limit = min(len(text), self._max_hold - 1)
        for size in range(limit, 0, -1):
            suffix = text[-size:]
            if any(
                name.casefold().startswith(suffix.casefold()) and len(name) > size
                for name in self._names
            ):
                return size
        return 0
