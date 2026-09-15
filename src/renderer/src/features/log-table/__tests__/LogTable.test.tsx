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
import { ROW_HEIGHT } from '../LogTable';
import { cellHeight } from '../multiline';

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
const rowFor = (id: number) =>
  dataRows().find((r) => r.getAttribute('data-entry-id') === String(id))!;

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

  describe('multiline cells', () => {
    it('keeps a long single-line message truncated instead of wrapping across rows', async () => {
      // Regression test: the message/prop columns must only skip single-line truncation for
      // cells that actually contain a `\n`-separated value, not for the whole column, or a long
      // one-line message (no newline) wraps unbounded inside the still-28px row and visually
      // overlaps neighboring rows.
      const entries = makeMockEntries({ count: 3 });
      const long = entries.find((e) => e.id === 2)!;
      long.message = 'x'.repeat(500);
      long.raw = long.message;
      setupMock({ entries, props: propsOf(entries) });
      renderWithProviders(<LogView />);
      await waitFor(() => expect(dataRows()).toHaveLength(3));

      const row = rowFor(2);
      expect(row.style.minHeight).toBe(`${ROW_HEIGHT}px`);
      const messageCell = within(row).getAllByRole('cell').at(-1)!;
      expect(messageCell.className).toMatch(/\btruncate\b/);
    });

    it('previews the first 3 lines of a multi-line message with a static remaining-lines indicator', async () => {
      // Expanding a cell to show every line is implemented but disabled for now
      // (MULTILINE_EXPAND_ENABLED in columns.tsx) — no toggle button is rendered.
      const entries = makeMockEntries({ count: 3 });
      const multi = entries.find((e) => e.id === 3)!; // plain-text entry
      multi.message = 'line1\nline2\nline3\nline4\nline5';
      multi.raw = multi.message;
      setupMock({ entries, props: propsOf(entries) });
      renderWithProviders(<LogView />);
      await waitFor(() => expect(dataRows()).toHaveLength(3));

      expect(rowFor(3)).toHaveTextContent('line1');
      expect(rowFor(3)).toHaveTextContent('line3');
      expect(rowFor(3)).not.toHaveTextContent('line4');
      expect(rowFor(3)).toHaveTextContent('⏎ 2 more');
      expect(within(rowFor(3)).queryByRole('button')).not.toBeInTheDocument();
      expect(rowFor(3).style.minHeight).toBe(`${cellHeight(5, false)}px`);
      // A neighboring single-line row keeps the default row height.
      expect(rowFor(1).style.minHeight).toBe(`${ROW_HEIGHT}px`);
    });

    it('shrinks a row back down after filtering removes its multi-line content', async () => {
      // Row heights are derived from the currently loaded rows (see the `rowHeights` memo and its
      // `resizeItem` effect in LogTable.tsx), so applying a filter that changes what occupies a
      // given row must re-evaluate height too, not leave a stale tall row behind.
      const entries = makeMockEntries({ count: 5 });
      const multi = entries.find((e) => e.id === 3)!; // plain-text entry
      multi.message = 'line1\nline2\nline3\nline4\nline5';
      multi.raw = multi.message;
      setupMock({ entries, props: propsOf(entries) });
      renderWithProviders(<LogView />);
      await waitFor(() => expect(dataRows()).toHaveLength(5));
      expect(rowFor(3).style.minHeight).toBe(`${cellHeight(5, false)}px`);

      await screen.findByRole('textbox', { name: 'Query' });
      setQueryText('not id:3');
      pressInQuery('Enter');
      await waitFor(() => expect(useQueryStore.getState().dql).toBe('not id:3'));
      await waitFor(() => expect(dataRows()).toHaveLength(4));

      expect(screen.queryByText(/⏎ \d+ more/)).not.toBeInTheDocument();
      for (const row of dataRows()) {
        expect(row.style.minHeight).toBe(`${ROW_HEIGHT}px`);
      }
    });

    it('previews the first 3 lines of a multi-line dynamic prop value with a static remaining-lines indicator', async () => {
      const entries = makeMockEntries({ count: 4 });
      const multi = entries.find((e) => e.id === 4)!; // json entry
      multi.props = { ...multi.props, stack: 'stack1\nstack2\nstack3\nstack4' };
      multi.raw = JSON.stringify(multi.props);
      setupMock({ entries, props: propsOf(entries) });
      const user = userEvent.setup();
      renderWithProviders(<LogView />);
      await waitFor(() => expect(dataRows()).toHaveLength(4));

      await user.click(screen.getByRole('button', { name: /columns/i }));
      const dialog = screen.getByRole('dialog', { name: 'Columns' });
      const available = within(dialog).getByRole('list', { name: 'Available columns' });
      await user.click(within(available).getByLabelText('stack'));
      await waitFor(() =>
        expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('stack'),
      );

      expect(rowFor(4)).toHaveTextContent('stack1');
      expect(rowFor(4)).toHaveTextContent('stack3');
      expect(rowFor(4)).not.toHaveTextContent('stack4');
      expect(rowFor(4)).toHaveTextContent('⏎ 1 more');
    });

    it('shows an independent remaining-lines indicator for two multiline cells in the same row', async () => {
      const entries = makeMockEntries({ count: 4 });
      const multi = entries.find((e) => e.id === 4)!; // json entry
      multi.message = 'm1\nm2\nm3\nm4';
      multi.props = { ...multi.props, stack: 's1\ns2\ns3\ns4\ns5' };
      multi.raw = JSON.stringify(multi.props);
      setupMock({ entries, props: propsOf(entries) });
      const user = userEvent.setup();
      renderWithProviders(<LogView />);
      await waitFor(() => expect(dataRows()).toHaveLength(4));

      await user.click(screen.getByRole('button', { name: /columns/i }));
      const dialog = screen.getByRole('dialog', { name: 'Columns' });
      const available = within(dialog).getByRole('list', { name: 'Available columns' });
      await user.click(within(available).getByLabelText('stack'));
      await waitFor(() => expect(rowFor(4)).toHaveTextContent('s1'));

      expect(rowFor(4)).toHaveTextContent('m3');
      expect(rowFor(4)).not.toHaveTextContent('m4');
      expect(rowFor(4)).toHaveTextContent('s3');
      expect(rowFor(4)).not.toHaveTextContent('s4');
      // Each multiline cell reports its own remaining count (message: 4 lines -> 1 more; stack: 5
      // lines -> 2 more), not the other cell's.
      expect(rowFor(4)).toHaveTextContent('⏎ 1 more');
      expect(rowFor(4)).toHaveTextContent('⏎ 2 more');
    });
  });
});
