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
    HistoryResponse,
    GraphPayload,
    SimulationRequest,
    SimulationResponse,
    ValidationResponse,
)
from .graph_engine import build_graph, graph_json
from .ingestion import ExtractionError, ExtractionResult, extract_analysis
from .rules import validate
from .simulator import simulate
from . import storage

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
# Use the OS certificate store so HTTPS to Gemini works behind TLS-inspecting proxies.
truststore.inject_into_ssl()

app = FastAPI(title="ProtocolGraph graph engine")
logger = logging.getLogger(__name__)
MAX_PDF_BYTES = 20 * 1024 * 1024
DEFAULT_FRONTEND_ORIGINS = "http://localhost:5173,http://localhost:3000"

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
    return {"analysis_id": analysis_id, "graph": serialized, "findings": findings,
            "extraction_issues": result.issues}


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
