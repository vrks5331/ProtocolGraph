import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { analysisAdapter } from './lib/analysisAdapter';
vi.mock('./components/ProtocolCanvas', () => ({ default: ({ highlighted }: { highlighted: string[] }) => <div data-testid="canvas" data-highlighted={highlighted.join(',')}>Protocol canvas</div> }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('canonical mock adapter', () => {
  it('uses source fixtures and returns isolated data', () => {
    const baseline = analysisAdapter.getAnalysis('baseline');
    expect(baseline.graph.nodes).toHaveLength(5);
    expect(baseline.graph.edges).toHaveLength(2);
    expect(baseline.findings).toEqual([]);
    const injected = analysisAdapter.getAnalysis('injected');
    expect(injected.findings.map(finding => finding.check_id)).toEqual(['eligibility_conflict', 'missing_assessment']);
    expect(injected.findings[0].evidence.map(evidence => evidence.page)).toEqual([1, 2]);
    injected.graph.nodes[0].value = 99;
    expect(analysisAdapter.getAnalysis('injected').graph.nodes[0].value).toBe(18);
  });
  it('compares new, resolved, and remaining findings without changing source graphs', () => {
    const injected = analysisAdapter.getAnalysis('injected');
    const original = structuredClone(injected);
    const result = analysisAdapter.simulate(injected, 'visit_baseline', { day: 42 });
    expect(result.resolved_issues.map(f => f.check_id)).toEqual(['missing_assessment']);
    expect(result.remaining_issues.map(f => f.check_id)).toEqual(['eligibility_conflict']);
    expect(result.new_issues).toEqual([]);
    expect(result.affected_nodes).toEqual(['ct_scan', 'endpoint_response']);
    expect(injected).toEqual(original);
    const baseline = analysisAdapter.getAnalysis('baseline');
    expect(analysisAdapter.simulate(baseline, 'endpoint_response', { required_day: 70 }).new_issues[0].check_id).toBe('missing_assessment');
    expect(analysisAdapter.simulate(baseline, 'visit_day42', { day: 40, window_after_days: 2 }).new_issues).toEqual([]);
    expect(() => analysisAdapter.simulate(baseline, 'visit_day42', { day: -1 })).toThrow();
  });
});

describe('review workflow', () => {
  it('opens injected issues with meaningful evidence, and switches to baseline', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect((screen.getByLabelText('Protocol dataset') as HTMLSelectElement).value).toBe('injected');
    expect(screen.getByText('Review needed')).toBeTruthy();
    const inspector = screen.getByRole('complementary', { name: 'Evidence inspector' });
    expect(within(inspector).getByText(/Minimum age is 18/)).toBeTruthy();
    expect(within(inspector).getByText('Protocol · Page 2')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Protocol dataset'), 'baseline');
    expect(screen.getByText('No issues detected in demo rules')).toBeTruthy();
    expect(screen.queryByText('Review needed')).toBeNull();
    expect(within(inspector).getByText(/Tumor response will be assessed/)).toBeTruthy();
  });
  it('traces a missing assessment to connected concepts and source evidence', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Missing assessment Response assessment/ }));
    expect(screen.getByTestId('canvas').getAttribute('data-highlighted')).toBe('endpoint_response,ct_scan,visit_baseline');
    const inspector = screen.getByRole('complementary');
    expect(within(inspector).getByText(/CT imaging is scheduled only at baseline/)).toBeTruthy();
    await user.click(within(inspector).getByRole('button', { name: 'Inspect CT imaging' }));
    expect(within(inspector).getByText('ct_scan')).toBeTruthy();
    expect(within(inspector).getByText('Protocol · Page 3')).toBeTruthy();
  });
  it('collapses and reopens evidence, selects concepts, and navigates history', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Collapse evidence inspector' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand evidence inspector' }));
    expect(screen.getByRole('complementary')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Text view' }));
    await user.click(screen.getByRole('button', { name: /eligibility Minimum age in synopsis Page 1/ }));
    expect(within(screen.getByRole('complementary')).getByText(/Participants must be at least 18/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Demo history')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Baseline protocol Consistent eligibility/ }));
    expect(screen.getByText('No issues detected in demo rules')).toBeTruthy();
  });
  it('selects schedule fields, resolves assessment issues, and resets local preview', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Simulate' }));
    await user.selectOptions(screen.getByLabelText('Concept to edit'), 'visit_baseline');
    const day = screen.getByLabelText('Scheduled study day');
    await user.clear(day);
    await user.type(day, '42');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(screen.getByRole('heading', { name: 'Resolved 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Remaining 1' })).toBeTruthy();
    expect(analysisAdapter.getGraph('injected').nodes.find(n => n.id === 'visit_baseline')?.day).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect((day as HTMLInputElement).value).toBe('0');
    expect(screen.queryByText('Comparison with original')).toBeNull();
    await user.clear(day);
    expect((screen.getByRole('button', { name: 'Run simulation' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Protocol dataset'), 'baseline');
    expect((screen.getByLabelText('Required study day') as HTMLInputElement).value).toBe('42');
  });
  it('explains upload availability without processing files', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Upload protocol' }));
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
    expect(screen.getByText(/no files are uploaded or processed/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Continue with demo data/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
