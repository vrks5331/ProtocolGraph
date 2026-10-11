"""Gemini structured extraction of protocol graphs."""

from __future__ import annotations

import os
from typing import Protocol

from ..contracts import PageText
from .schema import EDGE_SIGNATURES, ExtractedGraph

DEFAULT_MODEL = "gemini-3.8-flash"

_EDGE_LINES = "\n".join(
    f"- {edge_type}: {source} -> {target}"
    for edge_type, (source, target) in EDGE_SIGNATURES.items()
)

SYSTEM_PROMPT = f"""You extract a knowledge graph from a clinical trial protocol.

Node types:
- objective: a study objective.
- endpoint: an outcome measure. Set required_day to the study day it is assessed, if stated.
- procedure: an assessment or intervention (e.g. CT scan, blood draw).
- visit: one scheduled visit. Set day (study day, where Day 1 is the first
  dose; pre-treatment visits such as screening have negative days) and
  window_before_days / window_after_days from its visit window. If a visit is
  timed from an event (e.g. 30 days after the last dose), omit day and state
  the timing in description. Create one
  visit node per occurrence; never model repeating schedules as a single node.
  Extract every visit in the schedule of activities, including screening,
  each treatment cycle, end of treatment, safety follow-up, and every
  long-term follow-up visit.
- eligibility: one inclusion or exclusion criterion. For criteria with a
  comparable value, set field (snake_case name, e.g. minimum_age) and value;
  omit both for qualitative criteria. If the protocol states the same criterion in
  several places, create one node per passage, even if the values differ.
- analysis: a statistical analysis.

Edges may only connect these node types, in this direction:
{_EDGE_LINES}

Rules:
- id: short, unique snake_case identifier.
- page: the page number from the [[PAGE n]] marker where the passage appears.
- source_text: copy the supporting passage verbatim from that page. Never
  paraphrase. Quote at least a full phrase; for table entries, quote the
  heading text that names the item together with its cell text exactly as
  printed, never a bare cell value like "2" or "X".
- Link every procedure to each visit where the schedule performs it, and link
  every endpoint to the procedure that measures it.
- Only set day, window_*_days, required_day, field and value on the node types above.
- On edges, set arm_ids to the treatment arms and pop_ids to the analysis
  populations the relationship is restricted to; omit them if it applies to all
  participants. Set condition_text when the protocol states a condition.
- On edges, set required to true when the protocol makes the relationship
  mandatory (e.g. "must", "will be performed", "is required") and false when it
  is optional (e.g. "may", "optional", "if clinically indicated"). Omit it if
  the protocol does not say.
- Extract only what the document states. Do not infer missing items."""


class LLMClient(Protocol):
    def generate(self, prompt: str) -> str: ...


def build_prompt(pages: list[PageText], feedback: str | None = None) -> str:
    document = "\n\n".join(f"[[PAGE {page.page}]]\n{page.text}" for page in pages)
    prompt = f"Extract the protocol graph from this document.\n\n{document}"
    if feedback:
        prompt += (
            "\n\nYour previous answer failed validation. Fix these errors:\n"
            f"{feedback}"
        )
    return prompt


class GeminiClient:
    def __init__(self, model: str | None = None, api_key: str | None = None,
                 system_instruction: str = SYSTEM_PROMPT,
                 response_schema: dict | None = None, temperature: float = 0):
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._model = model or os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
        self._system_instruction = system_instruction
        self._schema = response_schema or ExtractedGraph.model_json_schema()
        self._temperature = temperature

    def generate(self, prompt: str) -> str:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction,
                response_mime_type="application/json",
                response_json_schema=self._schema,
                temperature=self._temperature,
            ),
        )
        return response.text or ""
