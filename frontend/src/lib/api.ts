import type {
  AnalysisResponse,
  Edit,
  ExplanationResponse,
  HistoryResponse,
  ScenarioResponse,
  ScenarioSummary,
} from './types';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) {
      throw error;
    }
    throw new ApiError(`Cannot reach the ProtocolGraph API at ${API_BASE_URL}.`, 0);
  }
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Non-JSON error bodies keep the generic message.
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export function uploadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'Extraction took longer than 5 minutes and was stopped. Try again or use a shorter protocol.';
  }
  if (!(error instanceof ApiError)) return 'Upload failed unexpectedly. Try again.';
  switch (error.status) {
    case 400:
      return 'That file is not a PDF. Choose a text-based protocol PDF.';
    case 413:
      return 'The PDF is larger than the 20 MB limit.';
    case 422:
      return error.message;
    case 503:
      return `Extraction is unavailable: ${error.message}`;
    case 0:
      return `${error.message} Check that the backend is running.`;
    default:
      return 'Extraction failed on the server. Try again in a moment.';
  }
}

export function analyzeProtocol(file: File, signal?: AbortSignal): Promise<AnalysisResponse> {
  const body = new FormData();
  body.append('file', file);
  const timeout = AbortSignal.timeout(ANALYZE_TIMEOUT_MS);
  return request<AnalysisResponse>('/analyze', {
    method: 'POST',
    body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

export function getAnalysis(analysisId: string): Promise<AnalysisResponse> {
  return request<AnalysisResponse>(`/graph/${encodeURIComponent(analysisId)}`);
}

export function explainConcept(analysisId: string, nodeId: string): Promise<ExplanationResponse> {
  return request<ExplanationResponse>(
    `/graph/${encodeURIComponent(analysisId)}/nodes/${encodeURIComponent(nodeId)}/explain`,
    { method: 'POST' },
  );
}

export function explainRelationship(
  analysisId: string,
  edgeId: string,
): Promise<ExplanationResponse> {
  return request<ExplanationResponse>(
    `/graph/${encodeURIComponent(analysisId)}/edges/${encodeURIComponent(edgeId)}/explain`,
    { method: 'POST' },
  );
}

export async function listHistory() {
  return (await request<HistoryResponse>('/history')).analyses;
}

const scenarioPath = (scenarioId: string) => `/scenarios/${encodeURIComponent(scenarioId)}`;
const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function saveScenario(
  analysisId: string,
  name: string,
  edits: Edit[],
): Promise<ScenarioResponse> {
  return request<ScenarioResponse>(
    `/graph/${encodeURIComponent(analysisId)}/scenarios`,
    jsonPost({ name, edits }),
  );
}

export async function listScenarios(analysisId: string): Promise<ScenarioSummary[]> {
  return (
    await request<{ scenarios: ScenarioSummary[] }>(
      `/graph/${encodeURIComponent(analysisId)}/scenarios`,
    )
  ).scenarios;
}

export function getScenario(scenarioId: string): Promise<ScenarioResponse> {
  return request<ScenarioResponse>(scenarioPath(scenarioId));
}

export function analyzeScenario(scenarioId: string): Promise<ScenarioResponse> {
  return request<ScenarioResponse>(`${scenarioPath(scenarioId)}/analyze`, { method: 'POST' });
}

export function explainScenario(scenarioId: string): Promise<ExplanationResponse> {
  return request<ExplanationResponse>(`${scenarioPath(scenarioId)}/explain`, { method: 'POST' });
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function pdfUrl(analysisId: string, page?: number | null): string {
  const url = `${API_BASE_URL}/graph/${encodeURIComponent(analysisId)}/pdf`;
  return page ? `${url}#page=${page}` : url;
}
