import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useUiStore } from '../../../store/ui';
import { WorkspaceDialog } from '../WorkspaceDialog';

describe('WorkspaceDialog', () => {
  it('creates a workspace and switches to it', async () => {
    const mock = setupMock();
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceDialog />);
    act(() => useUiStore.getState().setWorkspaceDialogOpen(true));
    await screen.findByRole('dialog', { name: 'Workspaces' });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/enter a name/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('New workspace'), 'default');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('New workspace'));
    await user.type(screen.getByLabelText('New workspace'), 'prod-eu10');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(mock.state.workspaces.map((w) => w.name)).toEqual(['default', 'prod-eu10']),
    );
    expect(mock.state.currentWorkspaceId).toBe(mock.state.workspaces[1]!.id);
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('current');
  });

  it('opens another workspace and deletes one after typed confirmation', async () => {
    const mock = setupMock();
    mock.state.workspaces.push({
      id: 'ws-2',
      name: 'other',
      path: 'C:\\mock\\other.sqlite',
      createdAt: 1,
      sizeBytes: 2048,
      exists: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceDialog />);
    act(() => useUiStore.getState().setWorkspaceDialogOpen(true));
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    const other = within(list).getAllByRole('listitem')[1]!;
    await user.click(within(other).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(mock.state.currentWorkspaceId).toBe('ws-2'));

    const first = within(list).getAllByRole('listitem')[0]!;
    await user.click(within(first).getByRole('button', { name: /delete default/i }));
    const confirmInput = await screen.findByLabelText(/type default to delete/i);
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toBeDisabled();
    await user.type(confirmInput, 'defaul');
    expect(deleteButton).toBeDisabled();
    await user.type(confirmInput, 't');
    await user.click(deleteButton);
    await waitFor(() => expect(mock.state.workspaces.map((w) => w.id)).toEqual(['ws-2']));
  });

  it('uses the native picker to open a file', async () => {
    const mock = setupMock({ pickFileResult: 'D:\\logs\\archive.sqlite' });
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceDialog />);
    act(() => useUiStore.getState().setWorkspaceDialogOpen(true));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /open file/i }));
    await waitFor(() => expect(mock.state.workspaces.some((w) => w.name === 'archive')).toBe(true));
    expect(mock.state.calls.map((c) => c.channel)).toEqual(
      expect.arrayContaining(['workspace:pickFile', 'workspace:openFile']),
    );
  });
});
