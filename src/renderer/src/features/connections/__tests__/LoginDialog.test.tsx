import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, sampleConnection, setupMock } from '../../../test/render';
import { useUiStore } from '../../../store/ui';
import { LoginDialog } from '../LoginDialog';

describe('LoginDialog', () => {
  it('logs in with username and password and remembers the user name', async () => {
    const mock = setupMock({ connections: [sampleConnection({ username: undefined })] });
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog />);
    act(() => useUiStore.getState().openLogin('conn-1'));
    const dialog = await screen.findByRole('dialog', { name: /log in to EU10/i });
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/username and password are required/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/bad credentials/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useUiStore.getState().loginConnectionId).toBeNull());
    expect(mock.state.auth['conn-1']).toMatchObject({ loggedIn: true, username: 'alice' });
    await waitFor(() => expect(mock.state.connections[0]?.username).toBe('alice'));
    const loginCall = mock.state.calls.find((c) => c.channel === 'auth:loginPassword');
    expect(loginCall?.req).not.toHaveProperty('origin');
  });

  it('sends the origin for custom IdP connections', async () => {
    const mock = setupMock({
      connections: [sampleConnection({ authMode: 'origin', origin: 'my-idp' })],
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog />);
    act(() => useUiStore.getState().openLogin('conn-1'));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/identity provider origin/i)).toHaveValue('my-idp');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useUiStore.getState().loginConnectionId).toBeNull());
    expect(mock.state.calls.find((c) => c.channel === 'auth:loginPassword')?.req).toMatchObject({
      username: 'alice',
      origin: 'my-idp',
    });
  });

  it('falls back to manual passcode entry when the SSO window is cancelled', async () => {
    const mock = setupMock({
      connections: [sampleConnection({ authMode: 'passcode' })],
      passcodeWindowResult: { kind: 'cancelled' },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog />);
    act(() => useUiStore.getState().openLogin('conn-1'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /open sso login window/i }));
    expect(await screen.findByText(/closed before a code was detected/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/one-time passcode/i), 'NOPE');
    await user.click(screen.getByRole('button', { name: /log in with passcode/i }));
    expect(await screen.findByText(/invalid passcode/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/one-time passcode/i));
    await user.type(screen.getByLabelText(/one-time passcode/i), 'PC123456');
    await user.click(screen.getByRole('button', { name: /log in with passcode/i }));
    await waitFor(() => expect(useUiStore.getState().loginConnectionId).toBeNull());
    expect(mock.state.auth['conn-1']?.loggedIn).toBe(true);
  });

  it('closes immediately when the SSO window yields a code', async () => {
    const mock = setupMock({ connections: [sampleConnection({ authMode: 'passcode' })] });
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog />);
    act(() => useUiStore.getState().openLogin('conn-1'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /open sso login window/i }));
    await waitFor(() => expect(useUiStore.getState().loginConnectionId).toBeNull());
    expect(mock.state.auth['conn-1']).toMatchObject({ loggedIn: true, username: 'sso-user' });
  });
});
