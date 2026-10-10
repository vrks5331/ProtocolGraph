"""Conversion of protocol PDF content into the shared graph contract.

Person 1 owns the implementation of this module on ``feat/pdf-extraction``.
"""

from ..contracts import GraphPayload


def extract_graph(pdf_bytes: bytes) -> GraphPayload:
    """Extract and validate a graph from a text-based protocol PDF."""
    raise NotImplementedError("Graph extraction has not been implemented")
