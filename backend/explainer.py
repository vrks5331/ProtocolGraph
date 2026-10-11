"""Plain-language explanations of protocol concepts for non-experts."""

from __future__ import annotations

import json

from .contracts import ConceptExplanation, Edge, Edit, GraphPayload, Node
from .graph_engine import edge_key
from .ingestion.gemini_client import GeminiClient, LLMClient

SYSTEM_PROMPT = """You explain clinical trial protocol content to someone with no
medical or statistical training.

Return:
- summary: two to four short sentences in everyday language saying what this
  item means for the study and its participants. Spell out abbreviations.
  Do not add facts that the input does not state, and give no medical advice.
- terms: every medical, statistical, or regulatory term or abbreviation in the
  input that a layperson might not know, each with a one-sentence meaning.
  Use an empty list if there are none."""

RELATIONSHIP_MEANINGS = {
    "SUPPORTS": "the endpoint is measured to answer the objective",
    "MEASURED_BY": "the endpoint is measured using the procedure",
    "SCHEDULED_AT": "the procedure is performed at the visit",
    "ANALYZED_BY": "the endpoint's results are evaluated with the statistical analysis",
    "REQUIRES_AT": "the eligibility criterion is checked at the visit",
}


def _fields(item) -> str:
    return json.dumps(item.model_dump(mode="json", exclude_none=True), indent=2)


def concept_prompt(node: Node) -> str:
    return f"Explain this {node.type} from a clinical trial protocol.\n\n{_fields(node)}"


def relationship_prompt(edge: Edge, source: Node, target: Node) -> str:
    return (
        "Explain, for a layperson, how these two items from a clinical trial protocol "
        f"are connected and why the connection matters. The relationship {edge.type} "
        f"means {RELATIONSHIP_MEANINGS.get(edge.type, 'they are related')}.\n\n"
        f"Relationship:\n{_fields(edge)}\n\n"
        f"From ({source.type}):\n{_fields(source)}\n\n"
        f"To ({target.type}):\n{_fields(target)}"
    )


def _show(value) -> str:
    return "unset" if value is None else json.dumps(value)


def _edit_line(edit: Edit, nodes: dict[str, Node], edges: dict[str, Edge]) -> str:
    change = f"{edit.field} changed from {_show(edit.before)} to {_show(edit.after)}"
    if edit.entity == "node":
        node = nodes[edit.target_id]
        return f"- {node.type} \"{node.label}\": {change}"
    edge = edges[edit.target_id]
    return (f"- relationship \"{nodes[edge.source].label}\" {edge.type} "
            f"\"{nodes[edge.target].label}\": {change}")


def _finding_lines(findings: list[dict]) -> str:
    return "\n".join(f"- {item['title']} ({item['check_id']})" for item in findings) or "- none"


def scenario_prompt(scenario: dict, base: GraphPayload) -> str:
    """Prompt for the effects of a scenario's edits, grounded in the protocol's own text."""
    nodes = {node.id: node for node in base.nodes}
    edges = {edge_key(edge): edge for edge in base.edges}
    edits = "\n".join(_edit_line(edit, nodes, edges) for edit in scenario["edits"])
    passages = "\n".join(
        f"- {nodes[node_id].label} (page {nodes[node_id].page or '?'}): "
        f"{nodes[node_id].source_text}"
        for node_id in scenario["affected_nodes"]
        if node_id in nodes and nodes[node_id].source_text
    ) or "- none"
    return (
        "A reviewer made hypothetical edits to a clinical trial protocol and re-ran its "
        "automatic consistency checks. Explain, for a layperson, what the edits change, why "
        "each consistency finding was resolved or introduced, and what that would mean for "
        "running the study. If no findings changed, say so and explain why the edits did not "
        "matter to the checks. Use only the information below.\n\n"
        f"Edits:\n{edits}\n\n"
        f"Findings resolved by the edits:\n{_finding_lines(scenario['resolved_issues'])}\n\n"
        f"Findings introduced by the edits:\n{_finding_lines(scenario['new_issues'])}\n\n"
        f"Findings unchanged:\n{_finding_lines(scenario['remaining_issues'])}\n\n"
        f"Original protocol text for the affected items:\n{passages}"
    )


def explain(prompt: str, client: LLMClient | None = None) -> ConceptExplanation:
    client = client or GeminiClient(
        system_instruction=SYSTEM_PROMPT,
        response_schema=ConceptExplanation.model_json_schema(),
        temperature=0.2,
    )
    return ConceptExplanation.model_validate_json(client.generate(prompt))
