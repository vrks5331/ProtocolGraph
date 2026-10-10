"""Logical consistency rules applied to a structurally valid extraction.

Rules repair or drop bad items and report what they did; only an empty
result is fatal.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from ..contracts import GraphPayload, NodeType, PageText
from .schema import EDGE_SIGNATURES, ConsistencyIssue, ExtractionError

FIELD_OWNERS: dict[str, str] = {
    "required_day": NodeType.ENDPOINT.value,
    "day": NodeType.VISIT.value,
    "window_before_days": NodeType.VISIT.value,
    "window_after_days": NodeType.VISIT.value,
    "field": NodeType.ELIGIBILITY.value,
    "value": NodeType.ELIGIBILITY.value,
}

# Shorter quotes (e.g. a bare "2" from a table cell) match almost any page.
MIN_QUOTE_CHARS = 15
# Table quotes stitch a row label to a cell, which pypdf never emits as one
# contiguous run, so they fall back to word matching on the cited page.
MIN_FUZZY_WORDS = 3

_QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'})


def _normalize(text: str) -> str:
    # Whitespace and dashes are removed entirely so PDF line breaks and
    # hyphenation (e.g. "MSI-\nH") cannot hide a verbatim quote.
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES).lower()
    return re.sub(r"[\s\-\u2010-\u2015]+", "", text)


def _words(text: str) -> set[str]:
    return set(re.findall(r"\w+", unicodedata.normalize("NFKC", text).lower()))


def _edge_id(edge: dict[str, Any]) -> str:
    return edge.get("id") or f"{edge['source']}__{edge['type']}__{edge['target']}"


def shift_negative_days(data: dict[str, Any]) -> list[ConsistencyIssue]:
    """Move pre-Day-1 visits (e.g. screening at day -14) to day 0.

    The shared contract requires day >= 0, so the visit is re-expressed as
    day 0 with a before-window that keeps its earliest allowed day.
    """
    issues = []
    for node in data.get("nodes", []):
        day = node.get("day")
        if node.get("type") != NodeType.VISIT.value or day is None or day >= 0:
            continue
        before = node.get("window_before_days") or 0
        after = node.get("window_after_days") or 0
        node["day"] = 0
        node["window_before_days"] = before - day
        node["window_after_days"] = max(0, day + after)
        issues.append(ConsistencyIssue(
            rule="negative_day", action="adjusted_day", item_id=node["id"],
            message=f"Day {day} re-expressed as day 0 with a "
                    f"{node['window_before_days']}-day before-window"))
    return issues


def check(
    payload: GraphPayload, pages: list[PageText]
) -> tuple[GraphPayload, list[ConsistencyIssue]]:
    issues: list[ConsistencyIssue] = []

    def report(rule: str, action: str, item_id: str, message: str) -> None:
        issues.append(
            ConsistencyIssue(rule=rule, action=action, item_id=item_id, message=message)
        )

    page_text = {page.page: _normalize(page.text) for page in pages}
    page_words = {page.page: _words(page.text) for page in pages}
    nodes: list[dict[str, Any]] = []
    for node in payload.nodes:
        data = node.model_dump(exclude_none=True)
        node_id = data["id"]

        for field, owner in FIELD_OWNERS.items():
            if field in data and data["type"] != owner:
                del data[field]
                report("misplaced_field", "stripped_field", node_id,
                       f"'{field}' only applies to {owner} nodes")

        source_text = data.get("source_text", "")
        quote = _normalize(source_text)
        cited = data.get("page")
        if len(quote) < MIN_QUOTE_CHARS:
            label_words = _words(data.get("label", ""))
            if (quote and quote in page_text.get(cited, "") and label_words
                    and label_words <= page_words.get(cited, set())):
                report("source_grounding", "fuzzy_match", node_id,
                       f"Short source_text; label words confirmed on page {cited}")
                nodes.append(data)
            else:
                report("source_grounding", "dropped_node", node_id,
                       "source_text is missing or too short to verify")
            continue
        if cited in page_text and quote in page_text[cited]:
            nodes.append(data)
            continue
        found = next((n for n, text in page_text.items() if quote in text), None)
        if found is not None:
            data["page"] = found
            report("source_grounding", "corrected_page", node_id,
                   f"source_text is on page {found}, not page {cited}")
            nodes.append(data)
            continue
        words = _words(source_text)
        if len(words) >= MIN_FUZZY_WORDS and words <= page_words.get(cited, set()):
            report("source_grounding", "fuzzy_match", node_id,
                   f"source_text words all appear on page {cited}, but not "
                   "as one passage (likely a table)")
            nodes.append(data)
            continue
        report("source_grounding", "dropped_node", node_id,
               "source_text does not appear in the document")

    node_types = {node["id"]: node["type"] for node in nodes}
    edges: list[dict[str, Any]] = []
    for edge in payload.edges:
        data = edge.model_dump(exclude_none=True)
        edge_id = _edge_id(data)
        source, target = data["source"], data["target"]

        if source not in node_types or target not in node_types:
            report("dropped_endpoint", "dropped_edge", edge_id,
                   "Edge references a node that was dropped")
            continue
        if source == target:
            report("self_loop", "dropped_edge", edge_id,
                   "Edge connects a node to itself")
            continue
        expected = EDGE_SIGNATURES[data["type"]]
        actual = (node_types[source], node_types[target])
        if actual != expected:
            report("edge_signature", "dropped_edge", edge_id,
                   f"{data['type']} must connect {expected[0]} -> {expected[1]}, "
                   f"not {actual[0]} -> {actual[1]}")
            continue
        edges.append(data)

    edges = _merge_duplicates(edges, report)
    for edge in edges:
        edge["id"] = _edge_id(edge)

    if not nodes or not edges:
        details = "; ".join(f"{i.item_id}: {i.message}" for i in issues)
        raise ExtractionError(
            "Extraction produced no usable "
            f"{'nodes' if not nodes else 'edges'}"
            + (f" ({details})" if details else "")
        )
    return GraphPayload.model_validate({"nodes": nodes, "edges": edges}), issues


def _merge_duplicates(edges: list[dict[str, Any]], report) -> list[dict[str, Any]]:
    """Collapse edges sharing a (source, target) pair, which DiGraph would overwrite.

    A missing arm_ids, pop_ids, or condition_text means the edge applies to
    everyone, so if any duplicate lacks one, the merged edge lacks it too.
    The merged edge is required if any duplicate is required.
    """
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for edge in edges:
        key = (edge["source"], edge["target"])
        if key not in merged:
            merged[key] = edge
            continue
        kept = merged[key]
        for field in ("arm_ids", "pop_ids"):
            if field in kept and field in edge:
                kept[field] = list(dict.fromkeys(kept[field] + edge[field]))
            else:
                kept.pop(field, None)
        if "condition_text" in kept and "condition_text" in edge:
            conditions = dict.fromkeys(kept["condition_text"].split(" OR "))
            conditions.update(dict.fromkeys([edge["condition_text"]]))
            kept["condition_text"] = " OR ".join(conditions)
        else:
            kept.pop("condition_text", None)
        if "required" in edge:
            kept["required"] = kept.get("required", False) or edge["required"]
        if "confidence" in edge:
            kept["confidence"] = max(kept.get("confidence", 0), edge["confidence"])
        report("duplicate_edge", "merged_edge", _edge_id(kept),
               f"Merged duplicate {edge['type']} edge {key[0]} -> {key[1]}")
    return list(merged.values())
