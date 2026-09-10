/**
 * Wildcard helpers shared by the in-memory evaluator and the SQL compiler so both
 * agree on semantics: `*` matches any run of characters (including empty); nothing else is special.
 */

const REGEX_META = /[.*+?^${}()|[\]\\/]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_META, '\\$&');
}

const regexCache = new Map<string, RegExp>();

/** Builds an anchored, case-insensitive RegExp from literal segments separated by wildcards. */
export function segmentsToRegExp(segments: readonly string[], caseInsensitive = true): RegExp {
  const key = (caseInsensitive ? 'i:' : 's:') + JSON.stringify(segments);
  let re = regexCache.get(key);
  if (!re) {
    re = new RegExp('^' + segments.map(escapeRegex).join('.*') + '$', caseInsensitive ? 'is' : 's');
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(key, re);
  }
  return re;
}

/** Treats every `*` in `glob` as a wildcard. Used for wildcard field names. */
export function globToRegExp(glob: string, caseInsensitive = true): RegExp {
  return segmentsToRegExp(glob.split('*'), caseInsensitive);
}

/** Escapes `%`, `_` and `\` for use in `LIKE ? ESCAPE '\'`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

/** Converts segments into a SQL LIKE pattern (use with `ESCAPE '\'`). */
export function segmentsToLike(segments: readonly string[]): string {
  return segments.map(escapeLike).join('%');
}

/** LIKE pattern for a case-insensitive substring search. */
export function containsToLike(s: string): string {
  return '%' + escapeLike(s) + '%';
}
