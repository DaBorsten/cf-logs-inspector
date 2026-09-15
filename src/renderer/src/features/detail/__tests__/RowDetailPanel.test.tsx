import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import { makeMockEntries, propsOf } from '../../../api/mock/entries';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { useSelectionStore } from '../../../store/selection';
import { useUiStore } from '../../../store/ui';
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
    const table = await within(panel).findByRole('table');
    expect(panel).toHaveTextContent('2026-09-10 10:00:04.000 Z');
    expect(panel).toHaveTextContent('#5');
    expect(table).toHaveTextContent('tenant');
    expect(table).toHaveTextContent('"t2"');
    // Fields sidebar
    const fields = within(panel).getByLabelText('Fields');
    expect(fields).toHaveTextContent('api');
    expect(fields).toHaveTextContent('JSON payload');

    await user.click(within(panel).getByRole('tab', { name: 'Raw' }));
    expect(within(panel).getByRole('tabpanel')).toHaveTextContent('"msg":"request 5 handled"');

    await user.click(within(panel).getByRole('button', { name: /close details/i }));
    expect(screen.queryByRole('region', { name: /entry details/i })).not.toBeInTheDocument();
    // Re-selecting reopens it.
    await user.click(rowFor(4));
    expect(await screen.findByRole('region', { name: /entry details/i })).toHaveTextContent('#4');
  });

  it('shows multi-line messages fully in the table row and detail panel', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    expect(rowFor(3)).toHaveTextContent('first line');
    expect(rowFor(3)).toHaveTextContent('second line');
    expect(rowFor(3)).toHaveTextContent('third line');
    expect(
      within(rowFor(3)).queryByRole('button', { name: /show \d+ more/i }),
    ).not.toBeInTheDocument();
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

  it('opens on the message tab when json is preferred but the entry has no parsed JSON', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    // id 6 is plain text in the fixture; default preference is 'json'.
    await user.click(rowFor(6));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    expect(within(panel).getByRole('tab', { name: 'Message' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('makes the clicked tab the sticky default for later rows, with a display-only fallback', async () => {
    seed();
    act(() => useUiStore.getState().setDefaultDetailTab('raw'));
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));

    // id 5 is JSON; opens on the seeded 'raw' preference.
    await user.click(rowFor(5));
    let panel = await screen.findByRole('region', { name: /entry details/i });
    const detailTabs = () => within(panel).getByRole('tablist', { name: 'Detail view' });
    expect(within(detailTabs()).getByRole('tab', { name: 'Raw' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Clicking JSON persists it as the new preference (no Settings dialog involved).
    await user.click(within(detailTabs()).getByRole('tab', { name: 'JSON' }));
    expect(useUiStore.getState().defaultDetailTab).toBe('json');
    expect(within(detailTabs()).getByRole('tab', { name: 'JSON' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // id 4 is also JSON; it now opens on the newly-clicked JSON tab, not the original 'raw' seed.
    await user.click(rowFor(4));
    panel = await screen.findByRole('region', { name: /entry details/i });
    expect(within(detailTabs()).getByRole('tab', { name: 'JSON' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // id 6 is plain text: falls back to Message for display only, the preference stays 'json'.
    await user.click(rowFor(6));
    panel = await screen.findByRole('region', { name: /entry details/i });
    expect(within(detailTabs()).getByRole('tab', { name: 'Message' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(useUiStore.getState().defaultDetailTab).toBe('json');

    // id 5 (JSON) again: jumps back to JSON, proving the fallback never overwrote the preference.
    await user.click(rowFor(5));
    panel = await screen.findByRole('region', { name: /entry details/i });
    expect(within(detailTabs()).getByRole('tab', { name: 'JSON' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the flattened JSON table by default, with per-row filter and copy actions', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    await user.click(rowFor(5));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    const table = await within(panel).findByRole('table');
    expect(table).toHaveTextContent('tenant');
    expect(within(table).getByRole('button', { name: 'Filter for tenant' })).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'Table' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('switches to a plain, read-only JSON view via the in-panel toggle', async () => {
    seed();
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    await user.click(rowFor(5));
    const panel = await screen.findByRole('region', { name: /entry details/i });
    await within(panel).findByRole('table');
    const detailTabs = within(panel).getByRole('tablist', { name: 'Detail view' });
    const viewModeTabs = () => within(panel).getByRole('tablist', { name: 'JSON view' });

    await user.click(within(viewModeTabs()).getByRole('tab', { name: 'JSON' }));
    expect(useUiStore.getState().jsonViewMode).toBe('json');
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: 'Filter for tenant' }),
    ).not.toBeInTheDocument();
    expect(within(panel).getByRole('tabpanel')).toHaveTextContent('"tenant": "t2"');

    // The toggle only applies to the JSON tab and disappears on other tabs.
    await user.click(within(detailTabs).getByRole('tab', { name: 'Raw' }));
    expect(within(panel).queryByRole('tablist', { name: 'JSON view' })).not.toBeInTheDocument();
  });
});
