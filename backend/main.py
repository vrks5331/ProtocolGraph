import logging
import os
from pathlib import Path
import sqlite3
from typing import Callable

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import ValidationError
import truststore

from .contracts import (
    ErrorResponse,
    AnalysisResponse,
    ConceptExplanation,
    ExplanationResponse,
    HistoryResponse,
    GraphPayload,
    ScenarioCreate,
    ScenarioListResponse,
    ScenarioResponse,
    ValidationResponse,
)
from .explainer import concept_prompt, explain, relationship_prompt, scenario_prompt
from .graph_engine import build_graph, edge_key, graph_json
from .ingestion import ExtractionError, ExtractionResult, extract_analysis
from .rules import validate
from .simulator import EditError, StaleEditError, apply_edits, run_scenario
from . import storage

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
# Use the OS certificate store so HTTPS to Gemini works behind TLS-inspecting proxies.
truststore.inject_into_ssl()

app = FastAPI(title="ProtocolGraph graph engine")
logger = logging.getLogger(__name__)
MAX_PDF_BYTES = 20 * 1024 * 1024
DEFAULT_FRONTEND_ORIGINS = (
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3000,http://localhost:3000"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.environ.get(
        "FRONTEND_ORIGINS", DEFAULT_FRONTEND_ORIGINS).split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def extract_with_gemini(pdf_bytes: bytes) -> ExtractionResult:
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(status_code=503,
                            detail="PDF extraction is not configured: set GEMINI_API_KEY")
    return extract_analysis(pdf_bytes)


def get_extractor() -> Callable[[bytes], ExtractionResult]:
    return extract_with_gemini


@app.exception_handler(sqlite3.Error)
@app.exception_handler(OSError)
async def storage_error(request, exc):
    from fastapi.responses import JSONResponse
    logger.exception("Analysis storage operation failed", exc_info=exc)
    return JSONResponse(status_code=503, content={"detail": "Analysis storage is unavailable"})


@app.post("/analyze", response_model=AnalysisResponse)
def analyze_pdf(file: UploadFile = File(...),
                extractor: Callable = Depends(get_extractor),
                db_path=Depends(storage.get_database_path)):
    try:
        pdf_bytes = file.file.read(MAX_PDF_BYTES + 1)
    finally:
        file.file.close()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 20 MiB size limit")
    if not pdf_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="A nonempty PDF upload is required")
    try:
        result = ExtractionResult.model_validate(extractor(pdf_bytes))
        graph = build_graph(result.graph)
        serialized = graph_json(graph)
        findings = validate(graph)
    except HTTPException:
        raise
    except ExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("PDF extraction or analysis failed")
        raise HTTPException(status_code=502, detail="PDF extraction or analysis failed") from exc
    analysis_id = storage.save_analysis(
        file.filename or "upload.pdf", result.raw_json, serialized, findings,
        result.issues, db_path=db_path, pdf_bytes=pdf_bytes,
    )
    return storage.fetch_analysis(analysis_id, db_path=db_path)


@app.get("/graph/{analysis_id}", response_model=AnalysisResponse)
def retrieve_graph(analysis_id: str, db_path=Depends(storage.get_database_path)):
    try:
        record = storage.fetch_analysis(analysis_id, db_path=db_path)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Stored analysis is unavailable") from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return record


@app.get("/graph/{analysis_id}/pdf", response_class=FileResponse)
def retrieve_pdf(analysis_id: str, db_path=Depends(storage.get_database_path)):
    record = storage.fetch_analysis(analysis_id, db_path=db_path)
    pdf_path = record and record["pdf_path"]
    if not pdf_path or not Path(pdf_path).is_file():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf",
                        filename=record["filename"], content_disposition_type="inline")


def explain_with_gemini(prompt: str) -> ConceptExplanation:
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(status_code=503,
                            detail="Explanations are not configured: set GEMINI_API_KEY")
    return explain(prompt)


def get_explainer() -> Callable[[str], ConceptExplanation]:
    return explain_with_gemini


def _explained(analysis_id: str, cache_key: str, item_id: str, db_path,
               explainer: Callable, build_prompt: Callable[[GraphPayload], str | None]):
    cached = storage.fetch_explanation(analysis_id, cache_key, db_path=db_path)
    if cached is not None:
        return {"item_id": item_id, **cached.model_dump()}
    record = storage.fetch_analysis(analysis_id, db_path=db_path)
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    prompt = build_prompt(record["graph"])
    if prompt is None:
        raise HTTPException(status_code=404, detail="Item not found in this analysis")
    explanation = _run_explainer(explainer, prompt)
    storage.save_explanation(analysis_id, cache_key, explanation, db_path=db_path)
    return {"item_id": item_id, **explanation.model_dump()}


def _run_explainer(explainer: Callable, prompt: str) -> ConceptExplanation:
    try:
        return ConceptExplanation.model_validate(explainer(prompt))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Explanation failed")
        raise HTTPException(status_code=502, detail="Explanation failed") from exc


@app.post("/graph/{analysis_id}/nodes/{node_id}/explain",
          response_model=ExplanationResponse)
def explain_node(analysis_id: str, node_id: str,
                 explainer: Callable = Depends(get_explainer),
                 db_path=Depends(storage.get_database_path)):
    def build(graph: GraphPayload):
        node = next((item for item in graph.nodes if item.id == node_id), None)
        return concept_prompt(node) if node else None
    return _explained(analysis_id, node_id, node_id, db_path, explainer, build)


@app.post("/graph/{analysis_id}/edges/{edge_id}/explain",
          response_model=ExplanationResponse)
def explain_edge(analysis_id: str, edge_id: str,
                 explainer: Callable = Depends(get_explainer),
                 db_path=Depends(storage.get_database_path)):
    def build(graph: GraphPayload):
        edge = next((item for item in graph.edges if edge_key(item) == edge_id), None)
        if edge is None:
            return None
        nodes = {node.id: node for node in graph.nodes}
        return relationship_prompt(edge, nodes[edge.source], nodes[edge.target])
    return _explained(analysis_id, f"edge:{edge_id}", edge_id, db_path, explainer, build)


@app.get("/history", response_model=HistoryResponse)
def history(db_path=Depends(storage.get_database_path)):
    return {"analyses": storage.list_history(db_path=db_path)}


@app.post(
    "/validate",
    response_model=ValidationResponse,
    responses={400: {"model": ErrorResponse}},
)
def validate_graph(payload: GraphPayload):
    try:
        graph = build_graph(payload)
        return {"graph": graph_json(graph), "issues": validate(graph)}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc



def _analysis_or_404(analysis_id: str, db_path) -> dict:
    record = storage.fetch_analysis(analysis_id, db_path=db_path)
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return record


def _scenario_or_404(scenario_id: str, db_path) -> dict:
    scenario = storage.fetch_scenario(scenario_id, db_path=db_path)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


@app.post(
    "/graph/{analysis_id}/scenarios",
    response_model=ScenarioResponse,
    status_code=201,
    responses={409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def create_scenario(analysis_id: str, request: ScenarioCreate,
                    db_path=Depends(storage.get_database_path)):
    record = _analysis_or_404(analysis_id, db_path)
    try:
        apply_edits(record["graph"], request.edits)
    except StaleEditError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except EditError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    scenario_id = storage.save_scenario(analysis_id, request.name, request.edits,
                                        db_path=db_path)
    return storage.fetch_scenario(scenario_id, db_path=db_path)


@app.get("/graph/{analysis_id}/scenarios", response_model=ScenarioListResponse)
def scenarios_for_analysis(analysis_id: str, db_path=Depends(storage.get_database_path)):
    _analysis_or_404(analysis_id, db_path)
    return {"scenarios": storage.list_scenarios(analysis_id, db_path=db_path)}


@app.get("/scenarios/{scenario_id}", response_model=ScenarioResponse)
def retrieve_scenario(scenario_id: str, db_path=Depends(storage.get_database_path)):
    return _scenario_or_404(scenario_id, db_path)


@app.post("/scenarios/{scenario_id}/analyze", response_model=ScenarioResponse,
          responses={409: {"model": ErrorResponse}})
def analyze_scenario(scenario_id: str, db_path=Depends(storage.get_database_path)):
    scenario = _scenario_or_404(scenario_id, db_path)
    if scenario["status"] == "analyzed":
        return scenario
    record = _analysis_or_404(scenario["analysis_id"], db_path)
    try:
        result = run_scenario(record["graph"], scenario["edits"])
    except EditError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    storage.save_scenario_result(scenario_id, result, db_path=db_path)
    return storage.fetch_scenario(scenario_id, db_path=db_path)


@app.post("/scenarios/{scenario_id}/explain", response_model=ExplanationResponse,
          responses={409: {"model": ErrorResponse}})
def explain_scenario(scenario_id: str, explainer: Callable = Depends(get_explainer),
                     db_path=Depends(storage.get_database_path)):
    scenario = _scenario_or_404(scenario_id, db_path)
    if scenario["explanation"] is not None:
        return {"item_id": scenario_id, **scenario["explanation"].model_dump()}
    if scenario["status"] != "analyzed":
        raise HTTPException(status_code=409, detail="Analyze the scenario before explaining it")
    record = _analysis_or_404(scenario["analysis_id"], db_path)
    explanation = _run_explainer(explainer, scenario_prompt(scenario, record["graph"]))
    storage.save_scenario_explanation(scenario_id, explanation, db_path=db_path)
    return {"item_id": scenario_id, **explanation.model_dump()}
