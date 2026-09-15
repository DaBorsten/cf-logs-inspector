import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import type { ExportRequest } from '@shared/model/export';
import { makeMockEntries, propsOf } from '../../../api/mock/entries';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { useSelectionStore } from '../../../store/selection';
import { EMPTY_SELECTION } from '../../log-table/selection';
import { LogView } from '../../log-table/LogView';

const dataRows = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-entry-id'));

beforeEach(() => {
  useQueryStore.setState({
    dql: '',
    sort: [...DEFAULT_SORT],
    sessionIds: undefined,
    time: undefined,
    tz: 'utc',
    tail: false,
    refreshIntervalMs: 0,
  });
  useSelectionStore.setState({
    selection: EMPTY_SELECTION,
    detailOpen: false,
    detailAutoOpenDisabled: false,
  });
});

function seed(count = 5) {
  const entries = makeMockEntries({ count });
  return setupMock({ entries, props: propsOf(entries) });
}

describe('ExportDialog', () => {
  it('exports all filtered rows with the visible columns and reports completion', async () => {
    const mock = seed();
    const user = userEvent.setup();
    useQueryStore.setState({ dql: 'level:info' });
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: /export/i }));
    const dialog = await screen.findByRole('dialog', { name: /export entries/i });
    expect(within(dialog).getByRole('radio', { name: /selected rows/i })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /csv/i }));
    await user.click(within(dialog).getByRole('button', { name: /^export \d+ entries/i }));

    await within(dialog).findByText(/exported 2 entries/i);
    expect(mock.state.exports).toHaveLength(1);
    const req = mock.state.exports[0] as ExportRequest;
    expect(req.format).toBe('csv');
    expect(req.columns).toEqual(['timestamp', 'level', 'app', 'message']);
    expect(req.scope).toMatchObject({ dql: 'level:info', snapshotId: 2 });
    expect(within(dialog).getByText('C:\\mock\\export.ndjson')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /reveal in folder/i }));
    expect(mock.state.calls.some((c) => c.channel === 'export:reveal')).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('exports the selected rows with all columns', async () => {
    const mock = seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(5));
    await user.click(dataRows()[0]!);
    await user.keyboard('{Control>}');
    await user.click(dataRows()[2]!);
    await user.keyboard('{/Control}');
    await user.click(screen.getByRole('button', { name: /export/i }));
    const dialog = await screen.findByRole('dialog', { name: /export entries/i });
    const selected = within(dialog).getByRole('radio', { name: /selected rows/i });
    expect(selected).toBeEnabled();
    await user.click(selected);
    await user.click(within(dialog).getByRole('radio', { name: /all fields/i }));
    await user.click(within(dialog).getByRole('button', { name: /^export \d+ entries/i }));
    await within(dialog).findByText(/exported/i);
    const req = mock.state.exports[0] as ExportRequest;
    expect(req.scope.ids?.length).toBeGreaterThan(0);
    expect(req.columns).toEqual(expect.arrayContaining(['raw', 'ts_ns', 'p:tenant']));
    expect(req.format).toBe('ndjson');
  });

  it('handles a cancelled save dialog and a cancelled job', async () => {
    const mock = seed();
    mock.state.exportSavePath = null;
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(5));
    await user.click(screen.getByRole('button', { name: /export/i }));
    const dialog = await screen.findByRole('dialog', { name: /export entries/i });
    await user.click(within(dialog).getByRole('button', { name: /^export \d+ entries/i }));
    await waitFor(() => expect(mock.state.exports).toHaveLength(1));
    // Still on the options page: nothing started.
    expect(within(dialog).getByRole('radio', { name: /ndjson/i })).toBeInTheDocument();

    mock.state.exportSavePath = 'C:\\mock\\slow.ndjson';
    mock.state.cancelledExports.add('job-2'); // the next job id
    await user.click(within(dialog).getByRole('button', { name: /^export \d+ entries/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/cancelled/i);
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('radio', { name: /ndjson/i })).toBeInTheDocument();
  });
});
