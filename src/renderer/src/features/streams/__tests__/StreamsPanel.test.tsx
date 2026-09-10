import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, sampleConnection, setupMock } from '../../../test/render';
import { initialStreamPicker, useUiStore } from '../../../store/ui';
import { StreamsPanel } from '../StreamsPanel';

const loggedIn = { 'conn-1': { loggedIn: true, username: 'alice', canRefresh: true } };

beforeEach(() => {
  useUiStore.setState({ streamPicker: initialStreamPicker });
});

describe('StreamsPanel', () => {
  it('asks for a connection when none exists', async () => {
    setupMock();
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    expect(await screen.findByText(/add a connection to start streaming/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /go to connections/i }));
    expect(useUiStore.getState().sidePanelTab).toBe('connections');
  });

  it('prompts to log in before showing orgs', async () => {
    setupMock({ connections: [sampleConnection()] });
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    expect(await screen.findByText(/not logged in to EU10/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(useUiStore.getState().loginConnectionId).toBe('conn-1');
  });

  it('cascades org -> space -> apps, filters, and starts the selected apps', async () => {
    const mock = setupMock({ connections: [sampleConnection()], auth: loggedIn });
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    const org = await screen.findByLabelText('Organization');
    await waitFor(() => expect(within(org).getAllByRole('option')).toHaveLength(3)); // placeholder + 2
    await user.selectOptions(org, 'org-1');
    const space = screen.getByLabelText('Space');
    await waitFor(() => expect(within(space).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(space, 'space-1');
    const apps = await screen.findByRole('list', { name: 'Applications' });
    await waitFor(() => expect(within(apps).getAllByRole('listitem')).toHaveLength(2));
    expect(apps).toHaveTextContent('worker');
    expect(apps).toHaveTextContent('stopped'); // app state badge

    await user.type(screen.getByPlaceholderText(/filter apps/i), 'api');
    expect(within(apps).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByPlaceholderText(/filter apps/i));
    await user.click(screen.getByRole('button', { name: /select all/i }));
    expect(screen.getByRole('button', { name: /start \(2\)/i })).toBeEnabled();
    await user.click(screen.getByLabelText(/include recent logs/i)); // turn recent off
    await user.click(screen.getByRole('button', { name: /start \(2\)/i }));

    await waitFor(() => expect(mock.state.sessions).toHaveLength(2));
    expect(mock.state.sessions.map((s) => [s.appName, s.status, s.orgName, s.spaceName])).toEqual([
      ['api', 'running', 'acme', 'dev'],
      ['worker', 'running', 'acme', 'dev'],
    ]);
    const starts = mock.state.calls.filter((c) => c.channel === 'session:start');
    expect(starts).toHaveLength(2);
    expect(starts[0]!.req).toMatchObject({ recent: false });

    const streams = await screen.findByRole('list', { name: 'Streams' });
    await waitFor(() => expect(within(streams).getAllByRole('listitem')).toHaveLength(2));
    expect(streams).toHaveTextContent('EU10 / acme / dev');
    // The picker marks running apps.
    await waitFor(() => expect(within(apps).getAllByText('streaming')).toHaveLength(2));
    expect(useUiStore.getState().streamPicker).toMatchObject({
      orgGuid: 'org-1',
      spaceGuid: 'space-1',
      recent: false,
    });
  });

  it('reuses an existing session for the same app instead of creating a duplicate', async () => {
    const mock = setupMock({
      connections: [sampleConnection()],
      auth: loggedIn,
      sessions: [
        {
          id: 7,
          name: 'api',
          connectionId: 'conn-1',
          appGuid: 'app-1',
          appName: 'api',
          createdAt: 1,
          status: 'stopped',
          entryCount: 42,
          pollIntervalMs: 1000,
        },
      ],
    });
    act(() =>
      useUiStore
        .getState()
        .setStreamPicker({ connectionId: 'conn-1', orgGuid: 'org-1', spaceGuid: 'space-1' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    const apps = await screen.findByRole('list', { name: 'Applications' });
    await waitFor(() => expect(within(apps).getAllByRole('listitem')).toHaveLength(2));
    await user.click(within(apps).getByLabelText('api'));
    await user.click(screen.getByRole('button', { name: /start \(1\)/i }));
    await waitFor(() => expect(mock.state.sessions[0]?.status).toBe('running'));
    expect(mock.state.sessions).toHaveLength(1);
    expect(mock.state.calls.filter((c) => c.channel === 'session:create')).toHaveLength(0);
    expect(mock.state.calls.filter((c) => c.channel === 'session:start')[0]?.req).toMatchObject({
      sessionId: 7,
      recent: true,
    });
  });

  it('controls running streams: stop, resume, interval, clear and delete', async () => {
    const mock = setupMock({
      connections: [sampleConnection()],
      auth: loggedIn,
      sessions: [
        {
          id: 1,
          name: 'api',
          connectionId: 'conn-1',
          appGuid: 'app-1',
          appName: 'api',
          createdAt: 1,
          status: 'running',
          entryCount: 10,
          pollIntervalMs: 1000,
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    const streams = await screen.findByRole('list', { name: 'Streams' });
    expect(streams).toHaveTextContent('streaming');

    await user.click(screen.getByRole('button', { name: 'Stop api' }));
    await waitFor(() => expect(mock.state.sessions[0]?.status).toBe('stopped'));
    await screen.findByRole('button', { name: 'Start api' });
    await user.click(screen.getByRole('button', { name: 'Start api' }));
    await waitFor(() => expect(mock.state.sessions[0]?.status).toBe('running'));
    expect(mock.state.calls.filter((c) => c.channel === 'session:start').at(-1)?.req).toEqual({
      sessionId: 1,
    });

    await user.selectOptions(screen.getByLabelText(/poll interval for api/i), '5000');
    await waitFor(() => expect(mock.state.sessions[0]?.pollIntervalMs).toBe(5000));

    await user.click(screen.getByRole('button', { name: /clear entries of api/i }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mock.state.sessions[0]?.entryCount).toBe(0));

    await user.click(screen.getByRole('button', { name: 'Delete api' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mock.state.sessions).toHaveLength(0));
  }, 15_000);

  it('offers a login shortcut for streams paused by authentication', async () => {
    setupMock({
      connections: [sampleConnection()],
      auth: loggedIn,
      sessions: [
        {
          id: 1,
          name: 'api',
          connectionId: 'conn-1',
          appGuid: 'app-1',
          appName: 'api',
          createdAt: 1,
          status: 'paused-auth',
          entryCount: 0,
          pollIntervalMs: 1000,
          lastError: { code: 'AUTH_REQUIRED', message: 'Session expired' },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<StreamsPanel />);
    const streams = await screen.findByRole('list', { name: 'Streams' });
    expect(streams).toHaveTextContent('login required');
    expect(streams).toHaveTextContent('Session expired');
    await user.click(within(streams).getByRole('button', { name: 'Log in' }));
    expect(useUiStore.getState().loginConnectionId).toBe('conn-1');
  });
});
