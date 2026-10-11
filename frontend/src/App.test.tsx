import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { API_BASE_URL } from './lib/api';
import { applyEdits } from './lib/edits';
import type {
  AnalysisResponse,
  AnalysisSummary,
  Edit,
  GraphPayload,
  ScenarioResponse,
  Selection,
} from './lib/types';
import { jsonResponse, sampleAnalysis } from './test/fixtures';

vi.mock('./components/ProtocolCanvas', () => ({
  EDITED_COLOR: '#e5a35b',
  default: ({
    graph,
    highlighted,
    layout,
    edited,
    onSelect,
  }: {
    graph: GraphPayload;
    highlighted: string[];
    layout: string;
    edited?: Set<string>;
    onSelect: (selection: Selection) => void;
  }) => (
    <div
      data-testid="canvas"
      data-highlighted={highlighted.join(',')}
      data-layout={layout}
      data-edited={[...(edited ?? [])].join(',')}
    >
      Protocol canvas
      <button onClick={() => undefined}>Pan graph</button>
      {graph.nodes.map((node) => (
        <button key={node.id} onClick={() => onSelect({ kind: 'node', id: node.id })}>
          Select {node.id}
        </button>
      ))}
    </div>
  ),
}));

const summary: AnalysisSummary = {
  analysis_id: 'a1',
  filename: 'NCT-sample.pdf',
  created_at: '2026-10-10T15:30:00+00:00',
};

const MOVE_VISIT: Edit = {
  entity: 'node',
  target_id: 'visit_baseline',
  field: 'day',
  before: 0,
  after: 42,
};

function analyzedScenario(scenario: ScenarioResponse): ScenarioResponse {
  const base = sampleAnalysis();
  const [conflict, missing] = base.findings;
  return {
    ...scenario,
    status: 'analyzed',
    graph: applyEdits(base.graph, scenario.edits),
    findings: [conflict],
    new_issues: [],
    resolved_issues: [missing],
    remaining_issues: [conflict],
    affected_nodes: ['endpoint_response', 'visit_baseline'],
  };
}

function mockApi({
  history = [] as AnalysisSummary[],
  analysis = sampleAnalysis() as AnalysisResponse,
  analyze = () => Promise.resolve(jsonResponse(analysis)),
  scenarios = [] as ScenarioResponse[],
} = {}) {
  const store = new Map(scenarios.map((item) => [item.scenario_id, item]));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(API_BASE_URL, '');
    if (path === '/history') return jsonResponse({ analyses: history });
    if (path === '/graph/a1/scenarios' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const saved: ScenarioResponse = {
        scenario_id: `s${store.size + 1}`,
        analysis_id: 'a1',
        name: body.name,
        created_at: '2026-10-10T16:00:00+00:00',
        edits: body.edits,
        status: 'saved',
      };
      store.set(saved.scenario_id, saved);
      return jsonResponse(saved, 201);
    }
    if (path === '/graph/a1/scenarios') {
      return jsonResponse({
        scenarios: [...store.values()].map((item) => ({
          ...item,
          edit_count: item.edits.length,
        })),
      });
    }
    const scenarioMatch = path.match(/^\/scenarios\/([^/]+)(\/analyze)?$/);
    if (scenarioMatch) {
      const stored = store.get(scenarioMatch[1]);
      if (!stored) return jsonResponse({ detail: 'Scenario not found' }, 404);
      if (scenarioMatch[2]) store.set(stored.scenario_id, analyzedScenario(stored));
      return jsonResponse(store.get(stored.scenario_id));
    }
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

  it('highlights a clicked concept and its neighbors', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    await screen.findByTestId('canvas');
    await user.click(screen.getByRole('button', { name: 'Select visit_baseline' }));
    expect(screen.getByTestId('canvas').getAttribute('data-highlighted')).toBe(
      'ct_scan,visit_baseline',
    );
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

  it('asks for an analysis before simulating', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<App />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'Simulate' }),
    );
    expect(screen.getByText('Open an analysis to simulate changes')).toBeTruthy();
  });
});

async function openSimulate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('canvas');
  await user.click(
    within(screen.getByRole('navigation')).getByRole('button', { name: 'Simulate' }),
  );
  return screen.getByRole('complementary', { name: 'Scenario editor' });
}

const saveButton = () => screen.getByRole('button', { name: /Save edits/ }) as HTMLButtonElement;

describe('Simulate scenarios', () => {
  it('only enables Save after a metadata edit, and undo restores the original', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    const editor = await openSimulate(user);
    expect(screen.getByText(/Changes never affect the original analysis/).textContent).toContain(
      'Scenario based on NCT-sample.pdf',
    );
    expect(saveButton().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Pan graph' }));
    await user.click(screen.getByRole('button', { name: 'Select visit_baseline' }));
    expect(saveButton().disabled).toBe(true);

    const day = within(editor).getByLabelText('Study day') as HTMLInputElement;
    expect(day.value).toBe('0');
    expect(within(editor).getAllByText('Affects checks')).toHaveLength(3);
    await user.clear(day);
    await user.type(day, '42');
    expect(within(editor).getByText('Pending changes (1)')).toBeTruthy();
    expect(
      within(editor).getByText('Baseline visit: study day changed from 0 to 42.'),
    ).toBeTruthy();
    expect(within(editor).getByText('Original: 0')).toBeTruthy();
    expect(screen.getByTestId('canvas').getAttribute('data-edited')).toBe('visit_baseline');
    expect(saveButton().disabled).toBe(false);

    await user.click(
      within(editor).getByRole('button', {
        name: 'Undo: Baseline visit: study day changed from 0 to 42.',
      }),
    );
    expect(within(editor).getByText('Pending changes (0)')).toBeTruthy();
    expect(day.value).toBe('0');
    expect(saveButton().disabled).toBe(true);
  });

  it('rejects invalid values without recording an edit', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    const editor = await openSimulate(user);
    await user.click(screen.getByRole('button', { name: 'Select visit_baseline' }));
    const window_ = within(editor).getByLabelText('Window before (days)');
    await user.type(window_, '-3');
    expect(within(editor).getByRole('alert').textContent).toMatch(/0 or more/);
    expect(within(editor).getByText('Pending changes (0)')).toBeTruthy();
  });

  it('saves edits, then analyzes the scenario and explains the resolved finding', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    const fetchMock = mockApi();
    render(<App />);
    const editor = await openSimulate(user);
    await user.click(screen.getByRole('button', { name: 'Select visit_baseline' }));
    const day = within(editor).getByLabelText('Study day');
    await user.clear(day);
    await user.type(day, '42');
    expect(screen.queryByRole('button', { name: /Analyze scenario/ })).toBeNull();

    await user.click(saveButton());
    const name = within(editor).getByLabelText('Scenario name') as HTMLInputElement;
    expect(name.value).toBe('Scenario 1');
    await user.clear(name);
    await user.type(name, 'Move baseline to day 42');
    await user.click(within(editor).getByRole('button', { name: /Save scenario/ }));

    const analyze = await within(editor).findByRole('button', { name: /Analyze scenario/ });
    const [, init] = calls(fetchMock, '/graph/a1/scenarios').find(
      ([, request]) => request?.method === 'POST',
    )!;
    expect(JSON.parse(String(init!.body))).toEqual({
      name: 'Move baseline to day 42',
      edits: [MOVE_VISIT],
    });
    expect(window.location.hash).toBe('#/analysis/a1/scenario/s1');
    expect((within(editor).getByLabelText('Study day') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Save edits/ })).toBeNull();

    await user.click(analyze);
    const results = await screen.findByRole('region', { name: 'Scenario results' });
    const resolved = within(results).getByRole('button', { name: /No linked assessment/ });
    expect(resolved.textContent).toContain(
      'Resolved by: Baseline visit: study day changed from 0 to 42.',
    );
    expect(
      within(results).getByRole('button', { name: /Conflicting values/ }).textContent,
    ).toContain('None of the edited items are part of this finding.');
    await user.click(resolved);
    expect(screen.getByTestId('canvas').getAttribute('data-highlighted')).toBe(
      'endpoint_response,ct_scan,visit_baseline',
    );
    expect(calls(fetchMock, '/scenarios/s1/analyze')).toHaveLength(1);
    expect(within(editor).getByText('1 finding resolved')).toBeTruthy();
    expect(within(results).getByText('1 finding resolved')).toBeTruthy();
    expect(resolved.textContent).toContain('In plain terms:');
    expect(within(results).queryByText('Why nothing changed')).toBeNull();

    await user.click(
      within(results).getByRole('button', { name: /Explain the effects in plain English/ }),
    );
    expect(await within(results).findByText(/CT scan before treatment/)).toBeTruthy();
    expect(calls(fetchMock, '/scenarios/s1/explain')).toHaveLength(1);
  });

  it('explains why a scenario changed nothing', async () => {
    const labelOnly: ScenarioResponse = {
      ...analyzedScenario({
        scenario_id: 's5',
        analysis_id: 'a1',
        name: 'Rename baseline',
        created_at: '2026-10-10T16:00:00+00:00',
        edits: [{ ...MOVE_VISIT, field: 'label', before: 'Baseline visit', after: 'Week 0' }],
        status: 'saved',
      }),
      resolved_issues: [],
      remaining_issues: sampleAnalysis().findings,
      findings: sampleAnalysis().findings,
    };
    labelOnly.graph = applyEdits(sampleAnalysis().graph, labelOnly.edits);
    window.location.hash = '#/analysis/a1/scenario/s5';
    mockApi({ scenarios: [labelOnly] });
    render(<App />);
    const results = await screen.findByRole('region', { name: 'Scenario results' });
    expect(within(results).getByText('No findings changed')).toBeTruthy();
    expect(within(results).getByText('Why nothing changed')).toBeTruthy();
    expect(within(results).getByText(/label is not used by the checks/)).toBeTruthy();
  });

  it('explains fields and concepts in plain English while editing', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/analysis/a1';
    mockApi();
    render(<App />);
    const editor = await openSimulate(user);
    expect(within(editor).getByText('What the checks look at')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Select endpoint_response' }));
    expect(within(editor).getByText(/The study day this result must be measured on/)).toBeTruthy();
    expect(within(editor).getByText(/An endpoint is the result the study measures/)).toBeTruthy();
    await user.click(within(editor).getByRole('button', { name: /Explain this in plain English/ }));
    expect(await within(editor).findByText(/CT scan before treatment/)).toBeTruthy();
  });

  it('reopens a saved scenario from History', async () => {
    const user = userEvent.setup();
    const saved = analyzedScenario({
      scenario_id: 's9',
      analysis_id: 'a1',
      name: 'Later baseline',
      created_at: '2026-10-10T16:00:00+00:00',
      edits: [MOVE_VISIT],
      status: 'saved',
    });
    const fetchMock = mockApi({ history: [{ ...summary, scenario_count: 1 }], scenarios: [saved] });
    render(<App />);
    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: 'History' }),
    );
    await user.click(await screen.findByRole('button', { name: /1 scenario/ }));
    await user.click(await screen.findByRole('button', { name: /Later baseline/ }));

    expect(window.location.hash).toBe('#/analysis/a1/scenario/s9');
    expect(await screen.findByRole('heading', { name: 'Later baseline' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Simulate scenarios' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Scenario results' })).toBeTruthy();
    expect(calls(fetchMock, '/scenarios/s9')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Duplicate/ }));
    expect(window.location.hash).toBe('#/analysis/a1');
    const editor = screen.getByRole('complementary', { name: 'Scenario editor' });
    expect(within(editor).getByText('Pending changes (1)')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });
});
