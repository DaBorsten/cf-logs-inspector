import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SORT } from '@shared/model/query';
import { makeMockEntries, propsOf } from '../../../api/mock/entries';
import { pressInQuery, queryText, setQueryText } from '../../../test/codemirror';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import { QueryBar } from '../QueryBar';

beforeEach(() => {
  useQueryStore.setState({
    dql: '',
    sort: [...DEFAULT_SORT],
    sessionIds: undefined,
    time: undefined,
    tz: 'local',
  });
});

function seed() {
  const entries = makeMockEntries({ count: 6 });
  return setupMock({ entries, props: propsOf(entries) });
}

describe('QueryBar', () => {
  it('mounts the editor, highlights tokens and applies on Enter, recording history', async () => {
    const mock = seed();
    renderWithProviders(<QueryBar />);
    await screen.findByRole('textbox', { name: 'Query' });
    setQueryText('level:error and tenant:t1');
    await waitFor(() => expect(document.querySelectorAll('.cm-dql-field')).toHaveLength(2));
    expect(document.querySelectorAll('.cm-dql-keyword')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    pressInQuery('Enter');
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('level:error and tenant:t1'));
    await waitFor(() => expect(mock.state.kv['query.history']).toBeDefined());
    expect(JSON.parse(mock.state.kv['query.history']!)).toEqual(['level:error and tenant:t1']);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled(); // nothing dirty
  });

  it('shows syntax errors and refuses to apply them; Escape reverts', async () => {
    seed();
    renderWithProviders(<QueryBar />);
    await screen.findByRole('textbox', { name: 'Query' });
    setQueryText('level:');
    expect(await screen.findByRole('alert')).toHaveTextContent(/expected a value/i);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    pressInQuery('Enter');
    expect(useQueryStore.getState().dql).toBe('');
    // The first Escape may only close the autocomplete popup opened while typing; the next one reverts.
    pressInQuery('Escape');
    if (queryText() !== '') pressInQuery('Escape');
    await waitFor(() => expect(queryText()).toBe(''));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists history and re-applies a picked query', async () => {
    const mock = seed();
    mock.state.kv['query.history'] = JSON.stringify(['app:api', 'level:warn']);
    const user = userEvent.setup();
    renderWithProviders(<QueryBar />);
    await screen.findByRole('textbox', { name: 'Query' });
    await user.click(screen.getByRole('button', { name: /query history/i }));
    const list = await screen.findByRole('list', { name: /recent queries/i });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['app:api', 'level:warn']);
    await user.click(within(list).getByRole('button', { name: 'level:warn' }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('level:warn'));
    expect(queryText()).toBe('level:warn');
    await waitFor(() =>
      expect(JSON.parse(mock.state.kv['query.history']!)).toEqual(['level:warn', 'app:api']),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // panel closes on pick
  });

  it('saves, applies and deletes filters', async () => {
    const mock = seed();
    const user = userEvent.setup();
    useQueryStore.setState({ time: { kind: 'relative', amount: 15, unit: 'm' } });
    renderWithProviders(<QueryBar />);
    await screen.findByRole('textbox', { name: 'Query' });
    setQueryText('level:error');
    await user.click(screen.getByRole('button', { name: /saved filters/i }));
    const dialog = await screen.findByRole('dialog', { name: /saved filters/i });
    expect(dialog).toHaveTextContent(/no saved filters/i);
    await user.type(within(dialog).getByLabelText('Filter name'), 'Errors');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(mock.state.filters).toHaveLength(1));
    expect(mock.state.filters[0]).toMatchObject({
      name: 'Errors',
      dql: 'level:error',
      timeFilter: { kind: 'relative', amount: 15, unit: 'm' },
    });
    const list = await screen.findByRole('list', { name: /saved filters/i });
    expect(list).toHaveTextContent('Errors');

    // Apply the saved filter after changing the draft and time.
    useQueryStore.setState({ time: undefined });
    setQueryText('something else');
    await user.click(within(list).getByRole('button', { name: /^Errors/ }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe('level:error'));
    expect(useQueryStore.getState().time).toEqual({ kind: 'relative', amount: 15, unit: 'm' });

    await user.click(screen.getByRole('button', { name: /saved filters/i }));
    await user.click(await screen.findByRole('button', { name: /delete filter errors/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mock.state.filters).toHaveLength(0));
  });

  it('clears the query with the clear button', async () => {
    seed();
    const user = userEvent.setup();
    useQueryStore.setState({ dql: 'level:error' });
    renderWithProviders(<QueryBar />);
    await screen.findByRole('textbox', { name: 'Query' });
    await waitFor(() => expect(queryText()).toBe('level:error'));
    await user.click(screen.getByRole('button', { name: /clear query/i }));
    await waitFor(() => expect(useQueryStore.getState().dql).toBe(''));
    expect(queryText()).toBe('');
  });
});
