import copy
import json
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfWriter

from backend.contracts import GraphPayload, PageText
from backend.ingestion import ExtractionError, extract_analysis
from backend.ingestion.consistency import check
from backend.ingestion.pdf_reader import extract_pages

ROOT = Path(__file__).resolve().parents[1]
BASELINE = json.loads((ROOT / "data" / "baseline.json").read_text())


def make_pdf(pages: list[list[str]]) -> bytes:
    """Build a minimal text PDF with one line of Helvetica per string."""

    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None,
               "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    page_ids = []
    for lines in pages:
        body = "BT /F1 11 Tf 72 720 Td 14 TL " + " ".join(
            f"({escape(line)}) Tj T*" for line in lines
        ) + " ET"
        objects.append(f"<< /Length {len(body)} >>\nstream\n{body}\nendstream")
        content_id = len(objects)
        objects.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        )
        page_ids.append(len(objects))
    kids = " ".join(f"{i} 0 R" for i in page_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>"

    out = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{obj}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n").encode()
    return out


def baseline_pdf() -> bytes:
    by_page: dict[int, list[str]] = {}
    for node in BASELINE["nodes"]:
        by_page.setdefault(node["page"], []).append(node["source_text"])
    return make_pdf([by_page[page] for page in sorted(by_page)])


def baseline_pages() -> list[PageText]:
    by_page: dict[int, list[str]] = {}
    for node in BASELINE["nodes"]:
        by_page.setdefault(node["page"], []).append(node["source_text"])
    return [PageText(page=p, text="\n".join(t)) for p, t in sorted(by_page.items())]


def gemini_output(**overrides) -> dict:
    data = copy.deepcopy(BASELINE)
    data.update(overrides)
    return data


class FakeClient:
    def __init__(self, *responses):
        self.responses = [
            r if isinstance(r, str) else json.dumps(r) for r in responses
        ]
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.responses.pop(0)


def run_check(data: dict):
    return check(GraphPayload.model_validate(data), baseline_pages())


# PDF reading

def test_extract_pages_returns_text_per_page():
    pages = extract_pages(make_pdf([["Hello page one."], ["Second page."]]))
    assert [p.page for p in pages] == [1, 2]
    assert "Hello page one." in pages[0].text


def test_extract_pages_rejects_pdf_without_text():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = BytesIO()
    writer.write(buffer)
    with pytest.raises(ValueError, match="no extractable text"):
        extract_pages(buffer.getvalue())


def test_extract_pages_rejects_non_pdf():
    with pytest.raises(ValueError, match="Could not read PDF"):
        extract_pages(b"not a pdf")


# Layer 1: Pydantic

def test_invalid_output_is_retried_with_feedback():
    client = FakeClient("{not json", gemini_output())
    result = extract_analysis(baseline_pdf(), client=client)
    assert len(result.graph.nodes) == 5
    assert "failed validation" in client.prompts[1]


def test_invalid_output_twice_raises():
    bad_type = gemini_output()
    bad_type["nodes"][0]["type"] = "not-a-type"
    with pytest.raises(ExtractionError, match="failed validation after 2"):
        extract_analysis(baseline_pdf(), client=FakeClient("{}", bad_type))


def test_dangling_edge_fails_structural_validation():
    data = gemini_output()
    data["edges"].append({"source": "ct_scan", "target": "ghost", "type": "SCHEDULED_AT"})
    with pytest.raises(ExtractionError):
        extract_analysis(baseline_pdf(), client=FakeClient(data, data))


# Layer 2: consistency rules

def test_baseline_passes_without_issues():
    payload, issues = run_check(gemini_output())
    assert issues == []
    assert len(payload.edges) == 2


def test_edge_with_wrong_signature_is_dropped():
    data = gemini_output()
    data["edges"].append({"source": "ct_scan", "target": "endpoint_response",
                          "type": "SUPPORTS"})
    payload, issues = run_check(data)
    assert len(payload.edges) == 2
    assert [(i.rule, i.action) for i in issues] == [("edge_signature", "dropped_edge")]


def test_self_loop_is_dropped():
    data = gemini_output()
    data["edges"].append({"source": "ct_scan", "target": "ct_scan",
                          "type": "SCHEDULED_AT"})
    _, issues = run_check(data)
    assert [i.rule for i in issues] == ["self_loop"]


def test_duplicate_edges_are_merged():
    data = gemini_output()
    data["edges"][1].update(arm_ids=["A"], condition_text="measurable disease")
    data["edges"].append({"source": "ct_scan", "target": "visit_day42",
                          "type": "SCHEDULED_AT", "arm_ids": ["B", "A"],
                          "condition_text": "investigator discretion"})
    payload, issues = run_check(data)
    merged = payload.model_dump()["edges"][1]
    assert len(payload.edges) == 2
    assert merged["arm_ids"] == ["A", "B"]
    assert merged["condition_text"] == "measurable disease OR investigator discretion"
    assert [i.action for i in issues] == ["merged_edge"]


def test_merged_edge_is_required_if_any_duplicate_is():
    data = gemini_output()
    data["edges"][1]["required"] = False
    data["edges"].append({"source": "ct_scan", "target": "visit_day42",
                          "type": "SCHEDULED_AT", "required": True})
    payload, _ = run_check(data)
    assert payload.model_dump()["edges"][1]["required"] is True


def test_merge_with_unrestricted_edge_drops_arm_restriction():
    data = gemini_output()
    data["edges"].append({"source": "ct_scan", "target": "visit_day42",
                          "type": "SCHEDULED_AT", "arm_ids": ["A"]})
    payload, _ = run_check(data)
    assert "arm_ids" not in payload.model_dump()["edges"][1]


def test_event_timed_visit_without_day_is_kept():
    data = gemini_output()
    del data["nodes"][4]["day"]
    payload, issues = run_check(data)
    assert "visit_day42" in {n.id for n in payload.nodes}
    assert issues == []


def test_misplaced_schedule_field_is_stripped():
    data = gemini_output()
    data["nodes"][3]["window_before_days"] = 2
    payload, issues = run_check(data)
    assert payload.nodes[3].window_before_days is None
    assert [i.action for i in issues] == ["stripped_field"]


def test_ungrounded_node_is_dropped():
    data = gemini_output()
    data["nodes"][0]["source_text"] = "Participants must be at least 16 years old."
    payload, issues = run_check(data)
    assert "age_synopsis" not in {n.id for n in payload.nodes}
    assert issues[0].rule == "source_grounding"


def test_wrong_page_is_corrected():
    data = gemini_output()
    data["nodes"][0]["page"] = 3
    payload, issues = run_check(data)
    assert payload.nodes[0].page == 1
    assert [i.action for i in issues] == ["corrected_page"]


def test_grounding_ignores_line_breaks_and_case():
    pages = [PageText(page=1, text="Tumor response in MSI-\nH cancer will be\n"
                                   "ASSESSED on study day 42.")]
    data = {"nodes": [{"id": "e", "type": "endpoint", "page": 1,
                       "source_text": "tumor response in MSI-H cancer will be "
                                      "assessed on study day 42"},
                      {"id": "p", "type": "procedure", "page": 1,
                       "source_text": "assessed on study day 42"}],
            "edges": [{"source": "e", "target": "p", "type": "MEASURED_BY"}]}
    _, issues = check(GraphPayload.model_validate(data), pages)
    assert issues == []


TABLE_PAGE = PageText(page=1, text=(
    "Treatment Cycle/Title: Screening 1 2 3\n"
    "Scheduling Window (Days): -14 to C1D1 ± 2 ± 3 ± 3\n"
    "CT imaging of chest x x"))


def table_graph(visit_quote: str) -> GraphPayload:
    return GraphPayload.model_validate({
        "nodes": [{"id": "ct", "type": "procedure", "page": 1, "source_text": "CT imaging of chest"},
                  {"id": "c2", "type": "visit", "day": 22, "page": 1,
                   "source_text": visit_quote}],
        "edges": [{"source": "ct", "target": "c2", "type": "SCHEDULED_AT"}],
    })


def test_table_quote_falls_back_to_word_match():
    quote = "Treatment Cycle/Title: 2 Scheduling Window (Days): ± 3"
    payload, issues = check(table_graph(quote), [TABLE_PAGE])
    assert "c2" in {n.id for n in payload.nodes}
    assert [i.action for i in issues] == ["fuzzy_match"]


def test_short_table_quote_is_kept_when_label_is_on_page():
    graph = table_graph("2").model_dump(exclude_none=True)
    graph["nodes"][1]["label"] = "Treatment Cycle 2"
    payload, issues = check(GraphPayload.model_validate(graph), [TABLE_PAGE])
    assert "c2" in {n.id for n in payload.nodes}
    assert [i.action for i in issues] == ["fuzzy_match"]


def test_word_match_rejects_words_missing_from_page():
    quote = "Treatment Cycle/Title: 2 Scheduling Window (Days): ± 7 weeks"
    with pytest.raises(ExtractionError, match="no usable edges"):
        check(table_graph(quote), [TABLE_PAGE])


def test_short_quote_is_not_trusted():
    data = gemini_output()
    data["nodes"][0]["source_text"] = "18 years"
    payload, issues = run_check(data)
    assert "age_synopsis" not in {n.id for n in payload.nodes}
    assert "too short" in issues[0].message


def test_edges_get_stable_ids():
    payload, _ = run_check(gemini_output())
    assert [e.id for e in payload.edges] == [
        "endpoint_response__MEASURED_BY__ct_scan",
        "ct_scan__SCHEDULED_AT__visit_day42",
    ]


def test_negative_screening_day_is_kept():
    data = gemini_output()
    data["nodes"][4]["day"] = -14
    result = extract_analysis(baseline_pdf(), client=FakeClient(data))
    assert result.graph.nodes[4].day == -14
    assert result.issues == []


def test_graph_without_edges_is_fatal():
    with pytest.raises(ExtractionError, match="no usable edges"):
        run_check(gemini_output(edges=[]))


# End to end

def test_extract_analysis_returns_graph_raw_output_and_issues():
    result = extract_analysis(baseline_pdf(), client=FakeClient(gemini_output()))
    assert {n.id for n in result.graph.nodes} == {n["id"] for n in BASELINE["nodes"]}
    assert json.loads(result.raw_json) == gemini_output()
    assert result.issues == []


def test_required_flag_reaches_graph():
    data = gemini_output()
    data["edges"][0]["required"] = True
    data["edges"][1]["required"] = False
    result = extract_analysis(baseline_pdf(), client=FakeClient(data))
    edges = result.graph.model_dump()["edges"]
    assert [edge["required"] for edge in edges] == [True, False]
