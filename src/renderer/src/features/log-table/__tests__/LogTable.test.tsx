import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import { makeMockEntries, propsOf } from '../../../api/mock/entries';
import { ApiEvents } from '../../../app/ApiEvents';
import { pressInQuery, setQueryText } from '../../../test/codemirror';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { formatTimestamp } from '../../../lib/time';
import { LogView } from '../LogView';

function seed(count: number) {
  const entries = makeMockEntries({ count });
  return setupMock({
    entries,
    props: propsOf(entries),
    sessions: [
      {
        id: 1,
        name: 'api',
        connectionId: 'c',
        appGuid: 'app-1',
        appName: 'api',
        createdAt: 1,
        status: 'running',
        entryCount: count,
        pollIntervalMs: 1000,
      },
    ],
  });
}

const dataRows = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-entry-id'));

beforeEach(() => {
  useQueryStore.setState({
    dql: '',
    sort: [...DEFAULT_SORT],
    sessionIds: undefined,
    time: undefined,
    tz: 'local',
    tail: false,
    refreshIntervalMs: 0,
  });
});

describe('formatTimestamp', () => {
  it('renders ms precision in UTC and local', () => {
    const ns = (BigInt(Date.parse('2026-09-10T10:00:00.123Z')) * 1_000_000n + 456n).toString();
    expect(formatTimestamp(ns, 'utc')).toBe('2026-09-10 10:00:00.123 Z');
    expect(formatTimestamp(ns, 'local')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.123$/);
  });
});

describe('LogTable', () => {
  it('renders the newest entries first with default columns', async () => {
    const mock = seed(5);
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(5));
    expect(screen.getByText('5 entries')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Timestamp', 'Level', 'App', 'Message']);
    expect(dataRows()[0]).toHaveAttribute('data-entry-id', '5');
    expect(dataRows()[0]).toHaveTextContent('request 5 handled');
    expect(dataRows()[0]).toHaveTextContent('ERROR');
    const query = mock.state.calls.find((c) => c.channel === 'entries:query')?.req as {
      snapshotId?: number;
    };
    expect(query.snapshotId).toBe(5);
  });

  it('sorts by clicking a header and cycles back to the default', async () => {
    const mock = seed(6);
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    await user.click(screen.getByRole('button', { name: /sort by level/i }));
    await waitFor(() =>
      expect(
        (
          mock.state.calls.filter((c) => c.channel === 'entries:query').at(-1)?.req as {
            sort: unknown;
          }
        ).sort,
      ).toEqual([{ key: 'level', dir: 'asc' }]),
    );
    expect(screen.getByRole('columnheader', { name: /level/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: /sort by level/i }));
    await waitFor(() =>
      expect(useQueryStore.getState().sort).toEqual([{ key: 'level', dir: 'desc' }]),
    );
    await user.click(screen.getByRole('button', { name: /sort by level/i }));
    expect(useQueryStore.getState().sort).toEqual(DEFAULT_SORT);
  });

  it('toggles fixed and dynamic columns and persists the layout', async () => {
    const mock = seed(4); // newest row (id 4) is a JSON line with tenant t1
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: /columns/i }));
    const dialog = screen.getByRole('dialog', { name: 'Columns' });
    const available = within(dialog).getByRole('list', { name: 'Available columns' });
    await user.click(within(available).getByLabelText('tenant'));
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
        'Timestamp',
        'Level',
        'App',
        'Message',
        'tenant',
      ]),
    );
    expect(dataRows()[0]).toHaveTextContent('t1');
    const visible = within(dialog).getByRole('list', { name: 'Visible columns' });
    await user.click(within(visible).getByLabelText('App'));
    await user.click(within(dialog).getByRole('button', { name: /move tenant up/i }));
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
        'Timestamp',
        'Level',
        'tenant',
        'Message',
      ]),
    );
    await waitFor(() => expect(mock.state.kv['layout.columns']).toBeDefined(), { timeout: 2000 });
    expect(JSON.parse(mock.state.kv['layout.columns']!)).toMatchObject({
      order: ['timestamp', 'level', 'p:tenant', 'message'],
    });
  });

  it('refreshes the snapshot on demand', async () => {
    const mock = seed(4);
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    mock.state.entries.push(
      ...makeMockEntries({ count: 2, startId: 5, startMs: Date.parse('2026-09-10T11:00:00Z') }),
    );
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(dataRows()).toHaveLength(6));
    expect(dataRows()[0]).toHaveAttribute('data-entry-id', '6');
    expect(screen.getByText('6 entries')).toBeInTheDocument();
  });

  it('keeps the snapshot stable after a batch and shows new entries on request', async () => {
    const mock = seed(4);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <LogView />
        <ApiEvents />
      </>,
    );
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    mock.state.entries.push(
      ...makeMockEntries({ count: 3, startId: 5, startMs: Date.parse('2026-09-10T11:00:00Z') }),
    );
    act(() => mock.emit('stream:batch', { sessionId: 1, inserted: 3, totalCount: 7, latestId: 7 }));
    const banner = await screen.findByRole('button', { name: /3 new entries/i });
    expect(dataRows()).toHaveLength(4); // snapshot unchanged until the user asks
    await user.click(banner);
    await waitFor(() => expect(dataRows()).toHaveLength(7));
    expect(dataRows()[0]).toHaveAttribute('data-entry-id', '7');
    expect(screen.queryByRole('button', { name: /\d+ new entr/i })).not.toBeInTheDocument();
  });

  it('applies DQL from the query bar and reports syntax errors without applying', async () => {
    seed(9);
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(9));
    await screen.findByRole('textbox', { name: 'Query' });
    setQueryText('level:error');
    pressInQuery('Enter');
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('level:error'));
    await waitFor(() =>
      expect(dataRows().every((r) => r.textContent?.includes('ERROR'))).toBe(true),
    );
    expect(dataRows().length).toBeGreaterThan(0);
    expect(screen.getByText(`${dataRows().length} entries`)).toBeInTheDocument();

    setQueryText('level:');
    expect(await screen.findByRole('alert')).toHaveTextContent(/expected a value/i);
    pressInQuery('Enter');
    expect(useQueryStore.getState().dql).toBe('level:error'); // not applied
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /clear query/i }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe(''));
    await waitFor(() => expect(dataRows()).toHaveLength(9));
  });

  it('tails new entries automatically and pauses while scrolled away or hovering', async () => {
    const mock = seed(4);
    const user = userEvent.setup();
    useQueryStore.setState({ tail: true });
    renderWithProviders(
      <>
        <LogView />
        <ApiEvents />
      </>,
    );
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    expect(screen.getByText('Live')).toBeInTheDocument();

    // New batch while resting at the top: applied without interaction.
    mock.state.entries.push(
      ...makeMockEntries({ count: 2, startId: 5, startMs: Date.parse('2026-09-10T11:00:00Z') }),
    );
    act(() => mock.emit('stream:batch', { sessionId: 1, inserted: 2, totalCount: 6, latestId: 6 }));
    await waitFor(() => expect(dataRows()).toHaveLength(6));

    // Scrolled away: the batch only shows up as a banner.
    const table = screen.getByRole('table');
    table.scrollTop = 200;
    fireEvent.scroll(table);
    await screen.findByText('Tail paused');
    mock.state.entries.push(
      ...makeMockEntries({ count: 1, startId: 7, startMs: Date.parse('2026-09-10T12:00:00Z') }),
    );
    act(() => mock.emit('stream:batch', { sessionId: 1, inserted: 1, totalCount: 7, latestId: 7 }));
    await screen.findByRole('button', { name: /1 new entry/i });
    expect(dataRows()).toHaveLength(6);

    // Back at the top: resumes and applies the pending entries.
    table.scrollTop = 0;
    fireEvent.scroll(table);
    await waitFor(() => expect(dataRows()).toHaveLength(7));
    expect(screen.getByText('Live')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stop tailing/i }));
    expect(useQueryStore.getState().tail).toBe(false);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('refreshes on the auto refresh interval when new entries exist', async () => {
    const mock = seed(3);
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    await user.selectOptions(screen.getByLabelText('Auto refresh'), '1000');
    expect(useQueryStore.getState().refreshIntervalMs).toBe(1000);
    // Use a tiny interval for the test itself.
    act(() => useQueryStore.setState({ refreshIntervalMs: 60 }));
    mock.state.entries.push(
      ...makeMockEntries({ count: 2, startId: 4, startMs: Date.parse('2026-09-10T11:00:00Z') }),
    );
    // Without ApiEvents nothing tells the table about the rows; the interval alone must not refresh
    // when the live count is unchanged...
    await new Promise((r) => setTimeout(r, 150));
    expect(dataRows()).toHaveLength(3);
    // ...but a relative time window refreshes every tick regardless.
    act(() => useQueryStore.setState({ time: { kind: 'relative', amount: 100, unit: 'd' } }));
    await waitFor(() => expect(dataRows()).toHaveLength(5));
    const queries = mock.state.calls.filter((c) => c.channel === 'entries:query').length;
    await new Promise((r) => setTimeout(r, 200));
    expect(mock.state.calls.filter((c) => c.channel === 'entries:query').length).toBeGreaterThan(
      queries,
    );
  });

  it('switches the time zone display', async () => {
    seed(1);
    const user = userEvent.setup();
    renderWithProviders(<LogView />);
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /time zone/i }));
    expect(dataRows()[0]).toHaveTextContent('2026-09-10 10:00:00.000 Z');
    expect(useQueryStore.getState().tz).toBe('utc');
  });
});
