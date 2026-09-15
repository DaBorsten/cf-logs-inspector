import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonTable } from '../JsonTable';

describe('JsonTable', () => {
  it.each([
    [
      { reason: { response: { headers: { 'x-test': 'value' } } } },
      'reason.response.headers.x-test',
    ],
    [{ a: { b: { c: 1 } } }, 'a.b.c'],
  ])('flattens a nested leaf to its full dotted path', (value, path) => {
    render(<JsonTable value={value} />);
    expect(screen.getByText(path)).toBeInTheDocument();
  });

  it('collapses array-of-object elements onto the shared parent path', () => {
    render(<JsonTable value={{ items: [{ name: 'a' }, { name: 'b' }] }} />);
    expect(screen.getAllByText('items.name')).toHaveLength(2);
    expect(screen.getByText('"a"')).toBeInTheDocument();
    expect(screen.getByText('"b"')).toBeInTheDocument();
  });

  it('shows an empty nested container as its own leaf', () => {
    render(<JsonTable value={{ empty: {}, list: [] }} />);
    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(screen.getByText('{0}')).toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });

  it('filters on the full dotted path of a leaf and copies its value', async () => {
    const onFilter = vi.fn();
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<JsonTable value={{ a: { b: 'x' } }} onFilter={onFilter} onCopy={onCopy} />);
    await user.click(screen.getByRole('button', { name: 'Filter for a.b' }));
    expect(onFilter).toHaveBeenCalledWith('a.b', 'x', false);
    await user.click(screen.getByRole('button', { name: 'Filter out a.b' }));
    expect(onFilter).toHaveBeenCalledWith('a.b', 'x', true);
    await user.click(screen.getByRole('button', { name: 'Copy a.b' }));
    expect(onCopy).toHaveBeenCalledWith('x');
  });

  it('keeps a string array intact and previews it as up to 3 lines with an expand toggle', async () => {
    const user = userEvent.setup();
    render(<JsonTable value={{ tags: ['a', 'b', 'c', 'd', 'e'] }} />);
    const row = screen.getByText('tags').closest('tr')!;
    expect(within(row).getByText('"a"')).toBeInTheDocument();
    expect(within(row).getByText('"c"')).toBeInTheDocument();
    expect(within(row).queryByText('"d"')).not.toBeInTheDocument();
    const more = within(row).getByRole('button', { name: /show 2 more/i });
    await user.click(more);
    expect(within(row).getByText('"d"')).toBeInTheDocument();
    expect(within(row).getByText('"e"')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /show less/i }));
    expect(within(row).queryByText('"d"')).not.toBeInTheDocument();
  });

  it('previews a multi-line string as up to 3 lines with an expand toggle', async () => {
    const user = userEvent.setup();
    const message = ['line1', 'line2', 'line3', 'line4'].join('\n');
    render(<JsonTable value={{ stack: message }} />);
    const row = screen.getByText('stack').closest('tr')!;
    expect(within(row).getByText('line1')).toBeInTheDocument();
    expect(within(row).getByText('line3')).toBeInTheDocument();
    expect(within(row).queryByText('line4')).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /show 1 more/i }));
    expect(within(row).getByText('line4')).toBeInTheDocument();
  });

  it('does not add an expand toggle for a short string array or multi-line string', () => {
    render(<JsonTable value={{ tags: ['a', 'b'], note: 'line1\nline2' }} />);
    const tagsRow = screen.getByText('tags').closest('tr')!;
    const noteRow = screen.getByText('note').closest('tr')!;
    expect(within(tagsRow).queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
    expect(within(noteRow).queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
  });
});
