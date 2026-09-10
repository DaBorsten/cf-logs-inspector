import * as React from 'react';
import { collectHighlightTerms, parse } from '@shared/dql';

const REGEX_META = /[.*+?^${}()|[\]\\/]/g;
const escape = (s: string): string => s.replace(REGEX_META, '\\$&');

/**
 * Regexes for the positive free-text / message literals of a DQL query (used to mark matches in the
 * message column and detail panel). Wildcards become lazy `.*?` gaps; matching is case-insensitive.
 */
export function buildHighlightTerms(dql: string): RegExp[] {
  if (!dql.trim()) return [];
  const result = parse(dql);
  if (!result.ok) return [];
  const out: RegExp[] = [];
  for (const { field, literal } of collectHighlightTerms(result.ast)) {
    if (field !== undefined && field !== 'message' && field !== 'msg' && field !== 'raw') continue;
    if (literal.hasWildcard && literal.segments) {
      const parts = literal.segments.filter((s) => s.length > 0).map(escape);
      if (parts.length === 0) continue;
      out.push(new RegExp(parts.join('.*?'), 'gi'));
    } else if (literal.raw.trim()) {
      out.push(new RegExp(escape(literal.raw), 'gi'));
    }
  }
  return out;
}

export interface TextSegment {
  text: string;
  hit: boolean;
}

/** Splits `text` into plain and highlighted segments (overlapping matches are merged). */
export function highlightSegments(text: string, terms: readonly RegExp[]): TextSegment[] {
  if (terms.length === 0 || !text) return [{ text, hit: false }];
  const ranges: [number, number][] = [];
  for (const re of terms) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: TextSegment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: text.slice(pos, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

export function Highlighted({
  text,
  terms,
}: {
  text: string;
  terms: readonly RegExp[];
}): React.JSX.Element {
  const segments = React.useMemo(() => highlightSegments(text, terms), [text, terms]);
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-sm bg-warning/40 text-inherit">
            {s.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </>
  );
}
