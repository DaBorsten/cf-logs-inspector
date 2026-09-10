export type TokenType =
  | 'lparen'
  | 'rparen'
  | 'colon'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'quoted'
  | 'term'
  | 'eof';

export interface Token {
  type: TokenType;
  /** Raw source slice. */
  text: string;
  /** Unescaped value (quoted / term). Equals `text` for punctuation. */
  value: string;
  start: number;
  end: number;
  /** Whitespace (or start of input) directly precedes this token. */
  precededBySpace: boolean;
  /** Quoted string without a closing quote. Emitted so highlighting still works. */
  unterminated?: true;
  /** Term only: fragments between unescaped `*`. Present iff the term contains a wildcard. */
  wildcardSegments?: string[];
}

const TERM_STOP = new Set([' ', '\t', '\n', '\r', '(', ')', ':', '<', '>', '"']);

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Splits DQL input into tokens. Never throws: malformed input yields best-effort tokens
 * (e.g. an unterminated quoted string) so editors can highlight while the user types.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  let precededBySpace = true;

  const push = (t: Omit<Token, 'precededBySpace'>): void => {
    tokens.push({ ...t, precededBySpace });
    precededBySpace = false;
  };

  while (i < n) {
    const ch = input[i]!;

    if (isSpace(ch)) {
      precededBySpace = true;
      i++;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === ':') {
      const type = ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : 'colon';
      push({ type, text: ch, value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (ch === '<' || ch === '>') {
      const two = input[i + 1] === '=';
      const text = two ? ch + '=' : ch;
      const type = ch === '>' ? (two ? 'gte' : 'gt') : two ? 'lte' : 'lt';
      push({ type, text, value: text, start: i, end: i + text.length });
      i += text.length;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        const c = input[i]!;
        if (c === '\\' && i + 1 < n) {
          value += input[i + 1]!;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      const tok: Omit<Token, 'precededBySpace'> = { type: 'quoted', text: input.slice(start, i), value, start, end: i };
      if (!closed) tok.unterminated = true;
      push(tok);
      continue;
    }

    // Term: run of non-stop characters with backslash escapes.
    const start = i;
    let value = '';
    const segments: string[] = [];
    let current = '';
    let sawWildcard = false;
    while (i < n) {
      const c = input[i]!;
      if (c === '\\' && i + 1 < n) {
        const esc = input[i + 1]!;
        value += esc;
        current += esc;
        i += 2;
        continue;
      }
      if (TERM_STOP.has(c)) break;
      if (c === '*') {
        sawWildcard = true;
        segments.push(current);
        current = '';
      } else {
        current += c;
      }
      value += c;
      i++;
    }
    if (i === start) {
      // Lone backslash at end of input: consume it as a literal to guarantee progress.
      value = input[i]!;
      current = value;
      i++;
    }
    segments.push(current);
    const tok: Omit<Token, 'precededBySpace'> = { type: 'term', text: input.slice(start, i), value, start, end: i };
    if (sawWildcard) tok.wildcardSegments = segments;
    push(tok);
  }

  tokens.push({ type: 'eof', text: '', value: '', start: n, end: n, precededBySpace });
  return tokens;
}
