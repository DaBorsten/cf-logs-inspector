import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, setupMock } from '../../../test/render';
import { useQueryStore } from '../../../store/query';
import {
  dateTimeInputToMs,
  describeTimeFilter,
  formatMinute,
  msToDateTimeInput,
} from '../../../lib/time';
import { TimeFilterControl } from '../TimeFilterControl';

beforeEach(() => {
  useQueryStore.setState({ time: undefined, tz: 'local' });
});

describe('time helpers', () => {
  const ms = Date.parse('2026-09-10T10:05:07Z');
  it('formats and parses datetime-local values in UTC', () => {
    expect(msToDateTimeInput(ms, 'utc')).toBe('2026-09-10T10:05:07');
    expect(dateTimeInputToMs('2026-09-10T10:05:07', 'utc')).toBe(ms);
    expect(dateTimeInputToMs('2026-09-10T10:05', 'utc')).toBe(ms - 7000);
    expect(dateTimeInputToMs('nope', 'utc')).toBeUndefined();
    expect(formatMinute(ms, 'utc')).toBe('2026-09-10 10:05');
  });
  it('round-trips local values', () => {
    const local = msToDateTimeInput(ms, 'local');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(dateTimeInputToMs(local, 'local')).toBe(ms);
  });
  it('describes filters', () => {
    expect(describeTimeFilter(undefined, 'local')).toBe('All time');
    expect(describeTimeFilter({ kind: 'relative', amount: 15, unit: 'm' }, 'local')).toBe(
      'Last 15 min',
    );
    expect(describeTimeFilter({ kind: 'relative', amount: 7, unit: 'd' }, 'local')).toBe(
      'Last 7 d',
    );
    expect(describeTimeFilter({ kind: 'absolute', fromMs: ms }, 'utc')).toBe(
      '2026-09-10 10:05 → now (UTC)',
    );
    expect(describeTimeFilter({ kind: 'absolute', toMs: ms }, 'utc')).toBe(
      'start → 2026-09-10 10:05 (UTC)',
    );
  });
});

describe('TimeFilterControl', () => {
  it('applies quick picks and shows the active range on the chip', async () => {
    setupMock();
    const user = userEvent.setup();
    renderWithProviders(<TimeFilterControl />);
    expect(screen.getByRole('button', { name: /time range/i })).toHaveTextContent('All time');
    await user.click(screen.getByRole('button', { name: /time range/i }));
    await user.click(screen.getByRole('button', { name: 'Last 15 min' }));
    expect(useQueryStore.getState().time).toEqual({ kind: 'relative', amount: 15, unit: 'm' });
    expect(screen.getByRole('button', { name: /time range/i })).toHaveTextContent('Last 15 min');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies a custom relative range and clears back to all time', async () => {
    setupMock();
    const user = userEvent.setup();
    renderWithProviders(<TimeFilterControl />);
    await user.click(screen.getByRole('button', { name: /time range/i }));
    const dialog = screen.getByRole('dialog', { name: 'Time range' });
    const amount = within(dialog).getByLabelText('Last');
    await user.clear(amount);
    await user.type(amount, '3');
    await user.selectOptions(within(dialog).getByLabelText('Unit'), 'h');
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[0]!);
    expect(useQueryStore.getState().time).toEqual({ kind: 'relative', amount: 3, unit: 'h' });

    await user.click(screen.getByRole('button', { name: /time range/i }));
    await user.click(screen.getByRole('button', { name: 'All time' }));
    expect(useQueryStore.getState().time).toBeUndefined();
  });

  it('applies an absolute range in UTC and validates the order', async () => {
    setupMock();
    useQueryStore.setState({ tz: 'utc' });
    const user = userEvent.setup();
    renderWithProviders(<TimeFilterControl />);
    await user.click(screen.getByRole('button', { name: /time range/i }));
    const dialog = screen.getByRole('dialog', { name: 'Time range' });
    const from = within(dialog).getByLabelText('From');
    const to = within(dialog).getByLabelText('To');
    const applyAbs = () => within(dialog).getAllByRole('button', { name: 'Apply' })[1]!;
    await user.type(from, '2026-09-10T12:00:00');
    await user.type(to, '2026-09-10T11:00:00');
    expect(within(dialog).getByText(/start must be before end/i)).toBeInTheDocument();
    expect(applyAbs()).toBeDisabled();
    await user.clear(to);
    await user.type(to, '2026-09-10T13:30:00');
    await user.click(applyAbs());
    expect(useQueryStore.getState().time).toEqual({
      kind: 'absolute',
      fromMs: Date.parse('2026-09-10T12:00:00Z'),
      toMs: Date.parse('2026-09-10T13:30:00Z'),
    });
    expect(screen.getByRole('button', { name: /time range/i })).toHaveTextContent(
      '2026-09-10 12:00 → 2026-09-10 13:30 (UTC)',
    );
  });
});
