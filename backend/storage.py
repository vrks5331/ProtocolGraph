"""SQLite persistence for immutable protocol analyses."""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from .contracts import AnalysisSummary, Finding, GraphPayload


def get_database_path() -> Path:
    return Path(os.environ.get("PROTOCOLGRAPH_DB_PATH", str(
        Path.home() / ".protocolgraph" / "analyses.sqlite3"
    )))


@contextmanager
def connection(db_path=None):
    path = Path(db_path) if db_path is not None else get_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        with db:
            db.execute("""CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY, filename TEXT NOT NULL,
                created_at TEXT NOT NULL, extracted_json TEXT NOT NULL,
                graph_json TEXT NOT NULL, findings_json TEXT NOT NULL,
                pdf_path TEXT
            )""")
            yield db
    finally:
        db.close()


def initialize_db(db_path=None) -> None:
    with connection(db_path):
        pass


def save_analysis(filename, extracted: GraphPayload, graph, findings,
                  db_path=None, pdf_path=None) -> str:
    analysis_id = str(uuid4())
    extracted = GraphPayload.model_validate(extracted)
    graph = GraphPayload.model_validate(graph).model_dump(mode="json", exclude_none=True)
    findings = [Finding.model_validate(item).model_dump(mode="json") for item in findings]
    with connection(db_path) as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?)", (
            analysis_id, filename, datetime.now(timezone.utc).isoformat(),
            json.dumps(extracted.model_dump(mode="json")), json.dumps(graph),
            json.dumps(findings), str(pdf_path) if pdf_path is not None else None,
        ))
    return analysis_id


def fetch_analysis(analysis_id: str, db_path=None):
    with connection(db_path) as db:
        row = db.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    if row is None:
        return None
    return {
        "analysis_id": row["id"], "filename": row["filename"],
        "created_at": datetime.fromisoformat(row["created_at"]),
        "extracted": GraphPayload.model_validate_json(row["extracted_json"]),
        "graph": GraphPayload.model_validate_json(row["graph_json"]),
        "findings": [Finding.model_validate(item) for item in json.loads(row["findings_json"])],
        "pdf_path": row["pdf_path"],
    }


def list_history(db_path=None) -> list[AnalysisSummary]:
    with connection(db_path) as db:
        rows = db.execute(
            "SELECT id, filename, created_at FROM analyses ORDER BY created_at DESC, rowid DESC"
        ).fetchall()
    return [AnalysisSummary(analysis_id=row["id"], filename=row["filename"],
                            created_at=datetime.fromisoformat(row["created_at"])) for row in rows]
