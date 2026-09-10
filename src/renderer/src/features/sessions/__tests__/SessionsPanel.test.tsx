import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import { makeMockEntries } from '../../../api/mock/entries';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { QueryBar } from '../../query-bar/QueryBar';
import { SessionsPanel } from '../SessionsPanel';

const sessions = [
  {
    id: 1,
    name: 'api',
    connectionId: 'c',
    appGuid: 'app-1',
    appName: 'api',
    createdAt: 1,
    status: 'running' as const,
    entryCount: 3,
    pollIntervalMs: 1000,
  },
  {
    id: 2,
    name: 'worker',
    connectionId: 'c',
    appGuid: 'app-2',
    appName: 'worker',
    createdAt: 2,
    status: 'stopped' as const,
    entryCount: 0,
    pollIntervalMs: 1000,
  },
];

beforeEach(() => {
  useQueryStore.setState({
    dql: '',
    sort: [...DEFAULT_SORT],
    sessionIds: undefined,
    time: undefined,
    tz: 'utc',
  });
});

describe('SessionsPanel', () => {
  it('scopes the query to a session, adds with ctrl, and clears from the chip', async () => {
    setupMock({ sessions, entries: makeMockEntries({ count: 3, sessionId: 1 }) });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <QueryBar />
        <SessionsPanel />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Sessions' });
    const rows = within(list).getAllByRole('button', { pressed: false });
    expect(rows).toHaveLength(2);
    await user.click(rows[0]!);
    expect(useQueryStore.getState().sessionIds).toEqual([1]);
    expect(within(list).getByRole('button', { pressed: true })).toHaveTextContent('api');
    const chip = await screen.findByRole('button', { name: /session scope: api/i });
    expect(chip).toBeInTheDocument();

    await user.keyboard('{Control>}');
    await user.click(within(list).getByRole('button', { name: /worker/, pressed: false }));
    await user.keyboard('{/Control}');
    expect(useQueryStore.getState().sessionIds).toEqual([1, 2]);
    expect(screen.getByRole('button', { name: /session scope: api, worker/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /session scope/i }));
    expect(useQueryStore.getState().sessionIds).toBeUndefined();
    expect(screen.queryByRole('button', { name: /session scope/i })).not.toBeInTheDocument();

    // Clicking the only scoped session again clears the scope.
    await user.click(within(list).getAllByRole('button', { pressed: false })[0]!);
    await user.click(within(list).getByRole('button', { pressed: true }));
    expect(useQueryStore.getState().sessionIds).toBeUndefined();
  });

  it('sets the time range to a session span and reports empty sessions', async () => {
    setupMock({ sessions, entries: makeMockEntries({ count: 3, sessionId: 1 }) });
    const user = userEvent.setup();
    renderWithProviders(<SessionsPanel />);
    await screen.findByRole('list', { name: 'Sessions' });
    await user.click(screen.getByRole('button', { name: /set time range to api/i }));
    await waitFor(() =>
      expect(useQueryStore.getState().time).toEqual({
        kind: 'absolute',
        fromMs: Date.parse('2026-09-10T10:00:00Z'),
        toMs: Date.parse('2026-09-10T10:00:02Z') + 1,
      }),
    );
    expect(useQueryStore.getState().sessionIds).toBeUndefined(); // range does not change the scope
    await user.click(screen.getByRole('button', { name: /set time range to worker/i }));
    expect(await screen.findByText(/no stored entries yet/i)).toBeInTheDocument();
  });
});
