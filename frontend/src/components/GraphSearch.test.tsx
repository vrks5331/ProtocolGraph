import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sampleAnalysis } from '../test/fixtures';
import GraphSearch from './GraphSearch';

afterEach(cleanup);

describe('GraphSearch', () => {
  it('opens on the magnifying glass and picks a matching concept', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GraphSearch graph={sampleAnalysis().graph} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Search the graph' }));
    await user.type(screen.getByRole('combobox', { name: 'Search the graph' }), 'baseline');
    await user.click(screen.getByRole('option', { name: /visit Baseline visit/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'node', id: 'visit_baseline' });
  });

  it('lists matching relationships and supports keyboard selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GraphSearch graph={sampleAnalysis().graph} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Search the graph' }));
    const box = screen.getByRole('combobox', { name: 'Search the graph' });
    await user.type(box, 'measured');
    expect(screen.getByRole('option', { name: /Tumor response assessment/ })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'edge',
      id: 'endpoint_response__MEASURED_BY__ct_scan',
    });
  });
});
