"""Text extraction from PDF bytes."""

from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from ..contracts import PageText


def extract_pages(pdf_bytes: bytes) -> list[PageText]:
    """Return non-empty text for each readable page in a text-based PDF."""
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        raw_pages = [page.extract_text() or "" for page in reader.pages]
    except PyPdfError as exc:
        raise ValueError(f"Could not read PDF: {exc}") from exc

    pages = [
        PageText(page=number, text=text.strip())
        for number, text in enumerate(raw_pages, start=1)
        if text.strip()
    ]
    if not pages:
        raise ValueError(
            "PDF contains no extractable text; scanned PDFs are not supported"
        )
    return pages
