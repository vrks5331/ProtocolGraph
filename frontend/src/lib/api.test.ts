import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, sampleAnalysis } from '../test/fixtures';
import {
  API_BASE_URL,
  ApiError,
  analyzeProtocol,
  getAnalysis,
  listHistory,
  pdfUrl,
  uploadErrorMessage,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('posts the PDF as multipart form data to /analyze', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleAnalysis()));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF-1.7'], 'protocol.pdf', { type: 'application/pdf' });
    const result = await analyzeProtocol(file);
    expect(result.analysis_id).toBe('a1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/analyze`);
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads analyses and history', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(sampleAnalysis()))
      .mockResolvedValueOnce(
        jsonResponse({
          analyses: [{ analysis_id: 'a1', filename: 'p.pdf', created_at: '2026-10-10T00:00:00Z' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect((await getAnalysis('a/1')).filename).toBe('NCT-sample.pdf');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/graph/a%2F1`);
    expect(await listHistory()).toHaveLength(1);
  });

  it('turns error responses into ApiError with the backend detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'No eligible nodes extracted' }, 422)),
    );
    const error = await getAnalysis('a1').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toBe('No eligible nodes extracted');
  });

  it('reports network failures as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await listHistory().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(uploadErrorMessage(error)).toMatch(/backend is running/);
  });

  it('maps upload failures to user-facing messages', () => {
    expect(uploadErrorMessage(new ApiError('x', 400))).toMatch(/not a PDF/);
    expect(uploadErrorMessage(new ApiError('x', 413))).toMatch(/20 MB/);
    expect(uploadErrorMessage(new ApiError('Nothing extracted', 422))).toBe('Nothing extracted');
    expect(uploadErrorMessage(new ApiError('GEMINI_API_KEY is not set', 503))).toMatch(
      /unavailable: GEMINI_API_KEY/,
    );
    expect(uploadErrorMessage(new ApiError('x', 502))).toMatch(/failed on the server/);
    expect(uploadErrorMessage(new DOMException('t', 'TimeoutError'))).toMatch(/5 minutes/);
  });

  it('builds PDF links with an optional page anchor', () => {
    expect(pdfUrl('a1')).toBe(`${API_BASE_URL}/graph/a1/pdf`);
    expect(pdfUrl('a1', 3)).toBe(`${API_BASE_URL}/graph/a1/pdf#page=3`);
  });
});
