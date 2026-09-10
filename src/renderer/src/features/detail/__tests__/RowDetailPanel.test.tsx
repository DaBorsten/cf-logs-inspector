import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import { makeMockEntries, propsOf } from '../../../api/mock/entries';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { useSelectionStore } from '../../../store/selection';
import { EMPTY_SELECTION } from '../../log-table/selection';
import { LogView } from '../../log-table/LogView';

const dataRows = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-entry-id'));
const rowFor = (id: number) =>
  dataRows().find((r) => r.getAttribute('data-entry-id') === String(id))!;
const selectedIds = () =>
  dataRows()
    .filter((r) => r.getAttribute('aria-selected') === 'true')
    .map((r) => Number(r.getAttribute('data-entry-id')));

let clipboard: { writeText: ReturnType<typeof vi.fn> };

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
  useSelectionStore.setState({ selection: EMPTY_SELECTION, detailOpen: false });
  clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
});

function seed(count = 6) {
  const entries = makeMockEntries({ count });
  // Give one entry a multi-line message to exercise the marker.
  const multi = entries.find((e) => e.id === 3)!;
  multi.message = 'first line\nsecond line\nthird line';
  multi.raw = multi.message;
  return setupMock({ entries, props: propsOf(entries) });
}

describe('row selection and detail panel', () => {
  it('opens the detail panel for a clicked row and shows raw, fields and JSON', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    expect(screen.queryByRole('region', { name: /entry details/i })).not.toBeInTheDocument();

    // id 5 is a JSON line (tenant t2, level ERROR); ids 3 and 6 are plain text in the fixture.
    await user.click(rowFor(5));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    expect(rowFor(5)).toHaveAttribute('aria-selected', 'true');
    const tree = await within(panel).findByRole('tree');
    expect(panel).toHaveTextContent('2026-09-10 10:00:04.000 Z');
    expect(panel).toHaveTextContent('#5');
    expect(tree).toHaveTextContent('tenant');
    expect(tree).toHaveTextContent('"t2"');
    // Fields sidebar
    const fields = within(panel).getByLabelText('Fields');
    expect(fields).toHaveTextContent('api');
    expect(fields).toHaveTextContent('JSON payload');

    await user.click(within(panel).getByRole('tab', { name: 'raw' }));
    expect(within(panel).getByRole('tabpanel')).toHaveTextContent('"msg":"request 5 handled"');

    await user.click(within(panel).getByRole('button', { name: /close details/i }));
    expect(screen.queryByRole('region', { name: /entry details/i })).not.toBeInTheDocument();
    // Re-selecting reopens it.
    await user.click(rowFor(4));
    expect(await screen.findByRole('region', { name: /entry details/i })).toHaveTextContent('#4');
  });

  it('marks multi-line messages and shows them fully in the detail panel', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    expect(rowFor(3)).toHaveTextContent('first line');
    expect(rowFor(3)).toHaveTextContent('⏎ 3');
    expect(rowFor(3)).not.toHaveTextContent('second line');
    await user.click(rowFor(3));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    expect(within(panel).getByRole('tabpanel')).toHaveTextContent('second line');
    expect(panel).toHaveTextContent('3 lines');
  });

  it('filters for and out of values from the JSON tree and the fields list', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    await user.click(rowFor(5));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    await user.click(await within(panel).findByRole('button', { name: 'Filter for tenant' }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('tenant:t2'));
    await waitFor(() => expect(dataRows().length).toBeLessThan(6));

    const fields = within(panel).getByLabelText('Fields');
    await user.click(within(fields).getByRole('button', { name: 'Filter out level' }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('tenant:t2 and not level:ERROR'));
    expect(
      within(panel).queryByRole('button', { name: 'Filter for app_guid' }),
    ).toBeInTheDocument();
  });

  it('highlights query literals in the message column', async () => {
    seed();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    act(() => useQueryStore.setState({ dql: 'request' }));
    await waitFor(() => expect(rowFor(5)?.querySelector('mark')).not.toBeNull());
    expect(rowFor(5).querySelector('mark')).toHaveTextContent('request');
  });

  it('supports keyboard navigation, range selection, copy as NDJSON and Escape', async () => {
    seed();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    const table = screen.getByRole('table');
    table.focus();
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(selectedIds()).toEqual([6]);
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    fireEvent.keyDown(table, { key: 'ArrowDown', shiftKey: true });
    expect(selectedIds()).toEqual([5, 4]);
    await screen.findByRole('region', { name: /entry details/i });
    expect(useSelectionStore.getState().selection.focus).toBe(4);

    fireEvent.keyDown(table, { key: 'c', ctrlKey: true });
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    const text = clipboard.writeText.mock.calls[0]![0] as string;
    const lines = text.split('\n').map((l) => JSON.parse(l) as { id: number; raw: string });
    expect(lines.map((l) => l.id)).toEqual([5, 4]);
    expect(lines[0]!.raw).toContain('request 5 handled');

    fireEvent.keyDown(table, { key: 'End' });
    expect(selectedIds()).toEqual([1]);
    fireEvent.keyDown(table, { key: 'Home', shiftKey: true });
    expect(selectedIds()).toEqual([6, 5, 4, 3, 2, 1]);
    fireEvent.keyDown(table, { key: 'Escape' });
    expect(selectedIds()).toEqual([]);
  });

  it('copies the raw line from the detail panel', async () => {
    seed();
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub; put the spy back on top of it.
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    await user.click(rowFor(6));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    await user.click(await within(panel).findByRole('button', { name: /^raw$/i }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('plain line 6'));
  });
});
