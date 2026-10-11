import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { API_BASE_URL } from './lib/api';
import type { AnalysisResponse, AnalysisSummary } from './lib/types';
import { jsonResponse, sampleAnalysis } from './test/fixtures';

vi.mock('./components/ProtocolCanvas', () => ({
  default: ({ highlighted, layout }: { highlighted: string[]; layout: string }) => (
    <div data-testid="canvas" data-highlighted={highlighted.join(',')} data-layout={layout}>
      Protocol canvas
    </div>
  ),
}));

const summary: AnalysisSummary = {
  analysis_id: 'a1',
  filename: 'NCT-sample.pdf',
  created_at: '2026-10-10T15:30:00+00:00',
};

function mockApi({
  history = [] as AnalysisSummary[],
  analysis = sampleAnalysis() as AnalysisResponse,
  analyze = () => Promise.resolve(jsonResponse(analysis)),
} = {}) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = url.replace(API_BASE_URL, '');
    if (path === '/history') return jsonResponse({ analyses: history });
    if (path.endsWith('/explain')) {
      return jsonResponse({
        item_id: path.split('/')[4],
        summary: 'Participants get a CT scan before treatment starts.',
        terms: [{ term: 'CT', meaning: 'Computed tomography, a detailed X-ray scan.' }],
      });
    }
    if (path.startsWith('/graph/')) return jsonResponse(analysis);
    if (path === '/analyze') return analyze();
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === `${API_BASE_URL}${path}`);

function pdf(name = 'protocol.pdf') {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProtocolGraph app', () => {
  it('starts empty with an upload prompt when no analysis is open', async () => {
    mockApi();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Upload a protocol to get started' })).toBeTruthy();
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.getByText('No protocol open')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Local workspace')).toBeTruthy());
  });

  it('uploads a protocol, opens its graph, and refreshes history', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Upload protocol/ })[0]);
    const dialog = screen.getByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Protocol PDF'), pdf());
    await user.click(within(dialog).getByRole('button', { name: /Analyze protocol/ }));
    expect(await screen.findByTestId('canvas')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Graph explorer' })).toBeTruthy();
    expect(screen.getAllByText('NCT-sample.pdf').length).toBeGreaterThan(0);
    expect(screen.getByText('Review needed')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/analysis/a1');
    const [, init] = calls(fetchMock, '/analyze')[0];
    expect(init!.method).toBe('POST');
    await waitFor(() => expect(calls(fetchMock, '/history')).toHaveLength(2));
  });

  it('shows the backend detail when extraction fails', async () => {
    const user = userEvent.setup();
    mockApi({
      analyze: () =>
        Promise.resolve(jsonResponse({ detail: 'Extraction produced no usable nodes' }, 422)),
    });
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Upload protocol/ })[0]);
    const dialog = screen.getByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Protocol PDF'), pdf());
    await user.click(within(dialog).getByRole('button', { name: /Analyze protocol/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Extraction produced no usable nodes',
    );
    expect(screen.queryByTestId('canvas')).toBeNull();
  });

  it('rejects files over the size limit before uploading', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Upload protocol/ })[0]);
    const dialog = screen.getByRole('dialog');
    const large = pdf('large.pdf');
    Object.defineProperty(large, 'size', { value: 21 * 1024 * 1024 });
    await user.upload(within(dialog).getByLabelText('Protocol PDF'), large);
    expect(within(dialog).getByRole('alert').textContent).toMatch(/20 MB/);
    expect(
      (within(dialog).getByRole('button', { name: /Analyze protocol/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(calls(fetchMock, '/analyze')).toHaveLength(0);
  });

  it('lists history and opens a saved analysis', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ history: [summary] });
    render(<App />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'History' }),
    );
    await user.click(await screen.findByRole('button', { name: /NCT-sample\.pdf Analyzed/ }));
    expect(await screen.findByTestId('canvas')).toBeTruthy();
    expect(calls(fetchMock, '/graph/a1')).toHaveLength(1);
    expect(window.location.hash).toBe('#/analysis/a1');
  });

  it('highlights finding context, including the missing assessment path', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    const canvas = await screen.findByTestId('canvas');
    expect(canvas.getAttribute('data-highlighted')).toBe('');
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Conflicting values for minimum_age/ }));
    expect(screen.getByTestId('canvas').getAttribute('data-highlighted')).toBe(
      'age_synopsis,age_eligibility',
    );
    const inspector = screen.getByRole('complementary', { name: 'Evidence inspector' });
    expect(within(inspector).getByText(/different values for minimum age \(18, 21\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /No linked assessment scheduled/ }));
    expect(screen.getByTestId('canvas').getAttribute('data-highlighted')).toBe(
      'endpoint_response,ct_scan,visit_baseline',
    );
    const [link] = within(inspector).getAllByRole('link', { name: /Open page 3 in PDF/ });
    expect(link.getAttribute('href')).toBe(`${API_BASE_URL}/graph/a1/pdf#page=3`);
    await user.click(within(inspector).getByRole('button', { name: 'Inspect CT imaging' }));
    expect(within(inspector).getByText('ct_scan')).toBeTruthy();
    expect(within(inspector).getByText('Quote matched the page approximately.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('explains a concept in plain English on request', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    const fetchMock = mockApi();
    render(<App />);
    await screen.findByTestId('canvas');
    await user.click(screen.getByRole('button', { name: 'Text view' }));
    await user.click(screen.getByRole('button', { name: /procedure CT imaging Page 3/ }));
    const inspector = screen.getByRole('complementary', { name: 'Evidence inspector' });
    expect(
      within(inspector).getByText(/A procedure is something done to participants/),
    ).toBeTruthy();
    await user.click(
      within(inspector).getByRole('button', { name: /Explain this in plain English/ }),
    );
    expect(await within(inspector).findByText(/CT scan before treatment/)).toBeTruthy();
    expect(within(inspector).getByText('Computed tomography, a detailed X-ray scan.')).toBeTruthy();
    const [, init] = calls(fetchMock, '/graph/a1/nodes/ct_scan/explain')[0];
    expect(init!.method).toBe('POST');
  });

  it('describes connections in plain language and explains them on request', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    const fetchMock = mockApi();
    render(<App />);
    await screen.findByTestId('canvas');
    await user.click(screen.getByRole('button', { name: 'Text view' }));
    await user.click(screen.getByRole('button', { name: /procedure CT imaging Page 3/ }));
    const inspector = screen.getByRole('complementary', { name: 'Evidence inspector' });
    expect(
      within(inspector).getByText(
        'Tumor response assessment is measured using CT imaging. The protocol says this is mandatory. Only when: If measurable disease.',
      ),
    ).toBeTruthy();
    expect(within(inspector).getByText('CT imaging is done at Baseline visit.')).toBeTruthy();
    await user.click(
      within(inspector).getAllByRole('button', { name: 'Explain this connection' })[0],
    );
    await user.click(
      within(inspector).getByRole('button', { name: /Explain this connection in plain English/ }),
    );
    expect(await within(inspector).findByText(/CT scan before treatment/)).toBeTruthy();
    expect(
      calls(fetchMock, '/graph/a1/edges/endpoint_response__MEASURED_BY__ct_scan/explain'),
    ).toHaveLength(1);
  });

  it('shows relationship details from the text view', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    await screen.findByTestId('canvas');
    await user.click(screen.getByRole('button', { name: 'Text view' }));
    await user.click(
      screen.getByRole('button', { name: /Tumor response assessment MEASURED BY CT imaging/ }),
    );
    const inspector = screen.getByRole('complementary', { name: 'Evidence inspector' });
    expect(within(inspector).getByText('Relationship details')).toBeTruthy();
    expect(within(inspector).getByText('If measurable disease')).toBeTruthy();
    expect(within(inspector).getByText('Yes')).toBeTruthy();
  });

  it('switches between web and flow layouts and remembers the choice', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    const { unmount } = render(<App />);
    expect((await screen.findByTestId('canvas')).getAttribute('data-layout')).toBe('web');
    await user.click(screen.getByRole('button', { name: 'Flow' }));
    expect(screen.getByTestId('canvas').getAttribute('data-layout')).toBe('flow');
    expect(screen.getByRole('button', { name: 'Flow' }).getAttribute('aria-pressed')).toBe('true');
    unmount();
    render(<App />);
    expect((await screen.findByTestId('canvas')).getAttribute('data-layout')).toBe('flow');
  });

  it('reports a missing analysis from the URL', async () => {
    window.location.hash = '#/analysis/gone';
    const fetchMock = mockApi();
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/history')
        ? jsonResponse({ analyses: [] })
        : jsonResponse({ detail: 'Analysis not found' }, 404),
    );
    render(<App />);
    expect(await screen.findByText(/This analysis no longer exists/)).toBeTruthy();
  });

  it('keeps Simulate as a placeholder tab', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<App />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'Simulate' }),
    );
    expect(screen.getByText('Schedule simulation is coming soon')).toBeTruthy();
  });
});
