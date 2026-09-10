import { isoToNs, msToNs, resolveTimeFilter } from '../time';

const NOW = Date.parse('2026-09-10T12:00:00Z');

describe('resolveTimeFilter', () => {
  it('returns no bounds without a filter', () => {
    expect(resolveTimeFilter(undefined, NOW)).toEqual({});
  });

  it.each([
    [{ kind: 'relative', amount: 5, unit: 'm' }, NOW - 5 * 60_000],
    [{ kind: 'relative', amount: 2, unit: 'h' }, NOW - 2 * 3_600_000],
    [{ kind: 'relative', amount: 7, unit: 'd' }, NOW - 7 * 86_400_000],
  ] as const)('%j -> from %d', (filter, fromMs) => {
    expect(resolveTimeFilter(filter, NOW)).toEqual({ fromNs: msToNs(fromMs) });
  });

  it('resolves absolute ranges with optional sides', () => {
    expect(resolveTimeFilter({ kind: 'absolute', fromMs: 1000, toMs: 2000 }, NOW)).toEqual({
      fromNs: 1_000_000_000n,
      toNs: 2_000_000_000n,
    });
    expect(resolveTimeFilter({ kind: 'absolute', toMs: 2000 }, NOW)).toEqual({
      toNs: 2_000_000_000n,
    });
    expect(resolveTimeFilter({ kind: 'absolute' }, NOW)).toEqual({});
  });

  it('rejects empty or inverted ranges', () => {
    expect(() => resolveTimeFilter({ kind: 'relative', amount: 0, unit: 'm' }, NOW)).toThrow(
      /positive/,
    );
    expect(() => resolveTimeFilter({ kind: 'absolute', fromMs: 5, toMs: 5 }, NOW)).toThrow(
      /before/,
    );
  });
});

describe('isoToNs', () => {
  it.each<[string, bigint | undefined]>([
    ['2026-01-01', 1_767_225_600_000n * 1_000_000n],
    ['2026-01-01T00:00:00Z', 1_767_225_600_000n * 1_000_000n],
    ['2026-01-01T00:00:00.123Z', 1_767_225_600_123n * 1_000_000n],
    ['2026-01-01T00:00:00.123456789Z', 1_767_225_600_123n * 1_000_000n + 456_789n],
    ['2026-01-01T01:00:00+01:00', 1_767_225_600_000n * 1_000_000n],
    ['12', undefined],
    ['abc', undefined],
    ['2026-13-45', undefined],
  ])('%s', (text, expected) => {
    expect(isoToNs(text)).toBe(expected);
  });
});
