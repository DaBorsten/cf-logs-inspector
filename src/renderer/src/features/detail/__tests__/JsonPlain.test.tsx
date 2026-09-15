import { render, screen } from '@testing-library/react';
import { JsonPlain } from '../JsonPlain';

describe('JsonPlain', () => {
  it('renders pretty-printed JSON with syntax highlighting and no filter or copy actions', () => {
    const { container } = render(
      <JsonPlain value={{ tenant: 't2', count: 3, ok: true, extra: null }} />,
    );
    expect(container).toHaveTextContent('"tenant": "t2"');
    expect(screen.getByText('"tenant"')).toHaveClass('text-primary');
    expect(screen.getByText('"t2"')).toHaveClass('text-success');
    expect(screen.getByText('3')).toHaveClass('text-warning');
    expect(screen.getByText('true')).toHaveClass('text-destructive');
    expect(screen.getByText('null')).toHaveClass('text-muted-foreground', 'italic');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nested objects, arrays and empty containers', () => {
    const { container } = render(
      <JsonPlain value={{ items: [{ name: 'a' }], empty: {}, list: [] }} />,
    );
    expect(container).toHaveTextContent('"name": "a"');
    expect(screen.getByText('{}')).toBeInTheDocument();
    expect(screen.getByText('[]')).toBeInTheDocument();
  });
});
