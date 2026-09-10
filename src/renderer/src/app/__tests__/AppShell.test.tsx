import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../AppShell';
import { renderWithProviders, sampleConnection, setupMock } from '../../test/render';

describe('AppShell', () => {
  it('shows the current workspace, version and side panel tabs', async () => {
    setupMock();
    renderWithProviders(<AppShell />);
    const switcher = await screen.findByRole('button', { name: /switch workspace/i });
    await waitFor(() => expect(switcher).toHaveTextContent('default'));
    expect(await screen.findByText(/v0\.1\.0-mock/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Streams' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(await screen.findByText(/no connections yet/i)).toBeInTheDocument();
  });

  it('switches tabs and lists connections with their login state', async () => {
    const mock = setupMock({
      connections: [
        sampleConnection(),
        sampleConnection({
          id: 'conn-2',
          name: 'Custom',
          apiUrl: 'https://api.sys.example.com',
          authMode: 'passcode',
        }),
      ],
      auth: { 'conn-2': { loggedIn: true, username: 'sso-user', canRefresh: true } },
    });
    const user = userEvent.setup();
    renderWithProviders(<AppShell />);
    const list = await screen.findByRole('list', { name: 'Connections' });
    expect(list).toHaveTextContent('EU10');
    expect(list).toHaveTextContent('api.cf.eu10.hana.ondemand.com');
    expect(await screen.findByText(/logged in as sso-user/i)).toBeInTheDocument();
    expect(screen.getByText(/not logged in/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(await screen.findByText(/no log sessions yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Streams' }));
    expect(await screen.findByText(/stream picker coming next/i)).toBeInTheDocument();
    expect(mock.state.calls.some((c) => c.channel === 'session:list')).toBe(true);
  });

  it('shows the empty workspace state and opens the workspace dialog', async () => {
    setupMock({ workspaces: [], currentWorkspaceId: null });
    const user = userEvent.setup();
    renderWithProviders(<AppShell />);
    expect(await screen.findByText(/no workspace is open/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /manage workspaces/i }));
    expect(await screen.findByRole('dialog', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('turns auth:required events into a toast that opens the login dialog', async () => {
    const mock = setupMock({ connections: [sampleConnection()] });
    const user = userEvent.setup();
    renderWithProviders(<AppShell />);
    await screen.findByRole('list', { name: 'Connections' });
    mock.emit('auth:required', { connectionId: 'conn-1', reason: 'refresh-failed' });
    const toastTitle = await screen.findByText(/login required for EU10/i);
    const toast = toastTitle.closest('li')!;
    expect(toast).toHaveTextContent(/could not be refreshed/i);
    await user.click(within(toast).getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /log in to EU10/i })).toBeInTheDocument(),
    );
  });
});
