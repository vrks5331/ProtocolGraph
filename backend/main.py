import logging
import sqlite3
from typing import Callable

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from pydantic import ValidationError

from .contracts import (
    ErrorResponse,
    AnalysisResponse,
    HistoryResponse,
    GraphPayload,
    SimulationRequest,
    SimulationResponse,
    ValidationResponse,
)
from .graph_engine import build_graph, graph_json
from .rules import validate
from .simulator import simulate
from . import storage

app = FastAPI(title="ProtocolGraph graph engine")
logger = logging.getLogger(__name__)
MAX_PDF_BYTES = 20 * 1024 * 1024


def extract_graph(pdf_bytes: bytes) -> GraphPayload:
    """Person 1 can connect their extractor here when ingestion is ready."""
    raise HTTPException(status_code=503, detail="PDF extraction is not available yet")


def get_extractor() -> Callable[[bytes], GraphPayload]:
    return extract_graph


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
        payload = GraphPayload.model_validate(extractor(pdf_bytes))
        graph = build_graph(payload)
        serialized = graph_json(graph)
        findings = validate(graph)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PDF extraction or analysis failed")
        raise HTTPException(status_code=502, detail="PDF extraction or analysis failed") from exc
    analysis_id = storage.save_analysis(file.filename or "upload.pdf", payload,
                                        serialized, findings, db_path=db_path)
    return {"analysis_id": analysis_id, "graph": serialized, "findings": findings}


@app.get("/graph/{analysis_id}", response_model=AnalysisResponse)
def retrieve_graph(analysis_id: str, db_path=Depends(storage.get_database_path)):
    try:
        record = storage.fetch_analysis(analysis_id, db_path=db_path)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Stored analysis is unavailable") from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return record


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


@app.post(
    "/simulate",
    response_model=SimulationResponse,
    responses={400: {"model": ErrorResponse}},
)
def simulate_graph(request: SimulationRequest):
    try:
        graph = build_graph(request.graph)
        return simulate(graph, request.node_id, request.changes)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
