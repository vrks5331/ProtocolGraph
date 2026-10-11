"""SQLite persistence for immutable protocol analyses."""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from .contracts import (
    AnalysisSummary, ConceptExplanation, Edit, ExtractionIssue, Finding, GraphPayload,
    ScenarioSummary,
)


def get_database_path() -> Path:
    return Path(os.environ.get("PROTOCOLGRAPH_DB_PATH", str(
        Path.home() / ".protocolgraph" / "analyses.sqlite3"
    )))


def _resolve(db_path) -> Path:
    return Path(db_path) if db_path is not None else get_database_path()


@contextmanager
def connection(db_path=None):
    path = _resolve(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        with db:
            db.execute("""CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY, filename TEXT NOT NULL,
                created_at TEXT NOT NULL, extracted_json TEXT NOT NULL,
                graph_json TEXT NOT NULL, findings_json TEXT NOT NULL,
                pdf_path TEXT, issues_json TEXT NOT NULL DEFAULT '[]'
            )""")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(analyses)")}
            if "issues_json" not in columns:
                db.execute("ALTER TABLE analyses ADD COLUMN "
                           "issues_json TEXT NOT NULL DEFAULT '[]'")
            cache_columns = {row["name"] for row in db.execute("PRAGMA table_info(explanations)")}
            if cache_columns and "item_key" not in cache_columns:
                db.execute("DROP TABLE explanations")
            db.execute("""CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, name TEXT NOT NULL,
                created_at TEXT NOT NULL, edits_json TEXT NOT NULL,
                result_json TEXT, explanation_json TEXT
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS scenarios_by_analysis "
                       "ON scenarios (analysis_id, created_at)")
            db.execute("""CREATE TABLE IF NOT EXISTS explanations (
                analysis_id TEXT NOT NULL, item_key TEXT NOT NULL,
                explanation_json TEXT NOT NULL, PRIMARY KEY (analysis_id, item_key)
            )""")
            yield db
    finally:
        db.close()


def initialize_db(db_path=None) -> None:
    with connection(db_path):
        pass


def save_analysis(filename, extracted_json: str, graph, findings, issues=(),
                  db_path=None, pdf_bytes: bytes | None = None) -> str:
    """Store one analysis; extracted_json is the raw extractor output, kept for audit."""
    analysis_id = str(uuid4())
    graph = GraphPayload.model_validate(graph).model_dump(mode="json", exclude_none=True)
    findings = [Finding.model_validate(item).model_dump(mode="json") for item in findings]
    issues = [ExtractionIssue.model_validate(item).model_dump(mode="json") for item in issues]

    pdf_path = None
    if pdf_bytes is not None:
        pdf_path = _resolve(db_path).parent / "pdfs" / f"{analysis_id}.pdf"
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(pdf_bytes)
    try:
        with connection(db_path) as db:
            db.execute(
                "INSERT INTO analyses (id, filename, created_at, extracted_json, "
                "graph_json, findings_json, issues_json, pdf_path) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (analysis_id, filename, datetime.now(timezone.utc).isoformat(),
                 extracted_json, json.dumps(graph), json.dumps(findings),
                 json.dumps(issues), str(pdf_path) if pdf_path else None),
            )
    except Exception:
        if pdf_path is not None:
            pdf_path.unlink(missing_ok=True)
        raise
    return analysis_id


def fetch_analysis(analysis_id: str, db_path=None):
    with connection(db_path) as db:
        row = db.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    if row is None:
        return None
    return {
        "analysis_id": row["id"], "filename": row["filename"],
        "created_at": datetime.fromisoformat(row["created_at"]),
        "extracted": json.loads(row["extracted_json"]),
        "graph": GraphPayload.model_validate_json(row["graph_json"]),
        "findings": [Finding.model_validate(item) for item in json.loads(row["findings_json"])],
        "extraction_issues": [ExtractionIssue.model_validate(item)
                              for item in json.loads(row["issues_json"])],
        "pdf_path": row["pdf_path"],
    }


def fetch_explanation(analysis_id: str, item_key: str, db_path=None):
    """item_key is a node id, or "edge:<edge id>" for a relationship."""
    with connection(db_path) as db:
        row = db.execute(
            "SELECT explanation_json FROM explanations WHERE analysis_id = ? AND item_key = ?",
            (analysis_id, item_key),
        ).fetchone()
    return ConceptExplanation.model_validate_json(row[0]) if row else None


def save_explanation(analysis_id: str, item_key: str, explanation, db_path=None) -> None:
    explanation = ConceptExplanation.model_validate(explanation)
    with connection(db_path) as db:
        db.execute(
            "INSERT OR REPLACE INTO explanations (analysis_id, item_key, explanation_json) "
            "VALUES (?, ?, ?)",
            (analysis_id, item_key, explanation.model_dump_json()),
        )


def list_history(db_path=None) -> list[AnalysisSummary]:
    with connection(db_path) as db:
        rows = db.execute(
            "SELECT a.id, a.filename, a.created_at, "
            "(SELECT COUNT(*) FROM scenarios s WHERE s.analysis_id = a.id) AS scenario_count "
            "FROM analyses a ORDER BY a.created_at DESC, a.rowid DESC"
        ).fetchall()
    return [AnalysisSummary(analysis_id=row["id"], filename=row["filename"],
                            created_at=datetime.fromisoformat(row["created_at"]),
                            scenario_count=row["scenario_count"]) for row in rows]


def save_scenario(analysis_id: str, name: str, edits, db_path=None) -> str:
    scenario_id = str(uuid4())
    edits = [Edit.model_validate(edit).model_dump(mode="json") for edit in edits]
    with connection(db_path) as db:
        db.execute(
            "INSERT INTO scenarios (id, analysis_id, name, created_at, edits_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (scenario_id, analysis_id, name, datetime.now(timezone.utc).isoformat(),
             json.dumps(edits)),
        )
    return scenario_id


def _scenario(row) -> dict:
    result = json.loads(row["result_json"]) if row["result_json"] else {}
    return {
        "scenario_id": row["id"], "analysis_id": row["analysis_id"], "name": row["name"],
        "created_at": datetime.fromisoformat(row["created_at"]),
        "edits": [Edit.model_validate(item) for item in json.loads(row["edits_json"])],
        "status": "analyzed" if result else "saved",
        **result,
        "explanation": (ConceptExplanation.model_validate_json(row["explanation_json"])
                        if row["explanation_json"] else None),
    }


def fetch_scenario(scenario_id: str, db_path=None):
    with connection(db_path) as db:
        row = db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    return _scenario(row) if row else None


def list_scenarios(analysis_id: str, db_path=None) -> list[ScenarioSummary]:
    with connection(db_path) as db:
        rows = db.execute(
            "SELECT * FROM scenarios WHERE analysis_id = ? ORDER BY created_at DESC, rowid DESC",
            (analysis_id,),
        ).fetchall()
    return [ScenarioSummary(**{key: value for key, value in _scenario(row).items()
                               if key in ScenarioSummary.model_fields},
                            edit_count=len(json.loads(row["edits_json"]))) for row in rows]


def save_scenario_result(scenario_id: str, result: dict, db_path=None) -> None:
    with connection(db_path) as db:
        db.execute("UPDATE scenarios SET result_json = ? WHERE id = ?",
                   (json.dumps(result), scenario_id))


def save_scenario_explanation(scenario_id: str, explanation, db_path=None) -> None:
    explanation = ConceptExplanation.model_validate(explanation)
    with connection(db_path) as db:
        db.execute("UPDATE scenarios SET explanation_json = ? WHERE id = ?",
                   (explanation.model_dump_json(), scenario_id))
