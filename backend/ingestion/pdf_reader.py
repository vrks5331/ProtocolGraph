"""Text extraction from PDF bytes.

Person 1 owns the implementation of this module on ``feat/pdf-extraction``.
"""

from ..contracts import PageText


def extract_pages(pdf_bytes: bytes) -> list[PageText]:
    """Return non-empty text for each readable page in a text-based PDF."""
    raise NotImplementedError("PDF reading has not been implemented")
