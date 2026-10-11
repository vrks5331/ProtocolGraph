"""Plain-language explanations of protocol concepts for non-experts."""

from __future__ import annotations

import json

from .contracts import ConceptExplanation, Edge, Node
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


def explain(prompt: str, client: LLMClient | None = None) -> ConceptExplanation:
    client = client or GeminiClient(
        system_instruction=SYSTEM_PROMPT,
        response_schema=ConceptExplanation.model_json_schema(),
        temperature=0.2,
    )
    return ConceptExplanation.model_validate_json(client.generate(prompt))
