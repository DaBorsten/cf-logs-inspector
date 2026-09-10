import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile } from '@shared/model/connection';
import { renderWithProviders, sampleConnection, setupMock } from '../../../test/render';
import { ConnectionForm } from '../ConnectionForm';

describe('ConnectionForm', () => {
  it('validates required fields before saving', async () => {
    const mock = setupMock();
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<ConnectionForm onSaved={onSaved} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /add connection/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(mock.state.calls.filter((c) => c.channel === 'connection:save')).toHaveLength(0);

    await user.type(screen.getByLabelText('Name'), 'Prod');
    await user.selectOptions(screen.getByLabelText('Login mode'), 'origin');
    await user.click(screen.getByRole('button', { name: /add connection/i }));
    expect(await screen.findByText(/origin key is required/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves a BTP region connection with the derived API URL', async () => {
    const mock = setupMock();
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<ConnectionForm onSaved={onSaved} onCancel={() => {}} />);
    await user.type(screen.getByLabelText('Name'), 'Prod US10');
    await user.selectOptions(screen.getByLabelText('Region'), 'us10');
    expect(screen.getByText('https://api.cf.us10.hana.ondemand.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls[0]![0] as ConnectionProfile;
    expect(saved).toMatchObject({
      name: 'Prod US10',
      apiUrl: 'https://api.cf.us10.hana.ondemand.com',
      region: 'us10',
      authMode: 'password',
      username: 'alice',
      skipSslValidation: false,
    });
    expect(mock.state.connections).toHaveLength(1);
  });

  it('supports custom URLs with TLS options and tests the endpoint', async () => {
    setupMock();
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<ConnectionForm onSaved={onSaved} onCancel={() => {}} />);
    await user.type(screen.getByLabelText('Name'), 'On-prem');
    await user.click(screen.getByLabelText(/custom api url/i));
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText('API URL is required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('API URL'), 'https://api.sys.example.com/');
    await user.click(screen.getByRole('button', { name: /tls options/i }));
    await user.click(screen.getByRole('switch', { name: /skip ssl/i }));
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText(/endpoint reachable/i)).toBeInTheDocument();
    expect(screen.getByText('https://log-cache.sys.example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0]![0]).toMatchObject({
      apiUrl: 'https://api.sys.example.com',
      skipSslValidation: true,
    });
    expect(onSaved.mock.calls[0]![0]).not.toHaveProperty('region');
  });

  it('edits an existing profile and shows backend errors', async () => {
    const existing = sampleConnection({ authMode: 'origin', origin: 'my-idp' });
    const mock = setupMock({ connections: [existing] });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(
      <ConnectionForm initial={existing} onSaved={onSaved} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('EU10');
    expect(screen.getByLabelText('Region')).toHaveValue('eu10');
    expect(screen.getByLabelText(/origin key/i)).toHaveValue('my-idp');
    mock.state.failures['connection:save'] = { code: 'INTERNAL', message: 'disk on fire' };
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('disk on fire')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(
      mock.state.calls.filter((c) => c.channel === 'connection:save').at(-1)?.req,
    ).toMatchObject({
      id: 'conn-1',
      origin: 'my-idp',
    });
  });
});
