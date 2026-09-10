import { KEYWORDS } from './ast';
import { tokenize, type Token, type TokenType } from './tokenizer';

export interface Replace {
  start: number;
  end: number;
}

export type CompletionContext =
  /** Suggest field names (inserted as `name:`) and free text; `prefix` is what the user typed so far. */
  | { kind: 'field-or-term'; prefix: string; replace: Replace }
  /** Suggest values for `field`. */
  | { kind: 'value'; field: string; prefix: string; replace: Replace; inGroup: boolean }
  /** After a complete clause: suggest and / or / not. */
  | { kind: 'operator'; prefix: string; replace: Replace }
  | { kind: 'none' };

const OP_TYPES: ReadonlySet<TokenType> = new Set(['colon', 'gt', 'gte', 'lt', 'lte']);

/**
 * Determines what to autocomplete at `cursor`. Token-based so it also works on incomplete input.
 */
export function completionContextAt(input: string, cursor: number): CompletionContext {
  const tokens = tokenize(input).filter((t) => t.type !== 'eof');
  const idx = tokens.findIndex((t) => t.start < cursor && cursor <= t.end);
  const inTok = idx >= 0 ? tokens[idx]! : undefined;

  if (inTok && (inTok.type === 'term' || inTok.type === 'quoted')) {
    const prefix = input.slice(inTok.start, cursor);
    const replace = { start: inTok.start, end: inTok.end };
    const prev = tokens[idx - 1];
    if (prev && OP_TYPES.has(prev.type) && !inTok.precededBySpace) {
      const field = fieldBefore(tokens, idx - 1);
      if (field !== undefined) {
        const g = groupInfo(tokens, idx);
        return {
          kind: 'value',
          field,
          prefix: stripQuote(prefix, inTok),
          replace,
          inGroup: g.inGroup,
        };
      }
    }
    if (inTok.type === 'quoted') return { kind: 'none' };
    const g = groupInfo(tokens, idx);
    if (g.inGroup && g.field !== undefined) {
      // inside field:( ... ) — literals here are values unless they look like keywords
      if (
        !KEYWORDS.has(prefix.toLowerCase()) &&
        prev &&
        (prev.type === 'lparen' || isKeyword(prev))
      ) {
        return { kind: 'value', field: g.field, prefix, replace, inGroup: true };
      }
    }
    if (
      prev &&
      (prev.type === 'term' || prev.type === 'quoted' || prev.type === 'rparen') &&
      !isKeyword(prev)
    ) {
      // "level:ERROR an|" → operator being typed (but a field name is equally possible; offer both via prefix)
      return { kind: 'operator', prefix, replace };
    }
    return { kind: 'field-or-term', prefix, replace };
  }

  if (inTok && OP_TYPES.has(inTok.type)) {
    // cursor immediately after ':' or a range operator
    const field = fieldBefore(tokens, idx);
    if (field !== undefined) {
      const g = groupInfo(tokens, idx + 1);
      return {
        kind: 'value',
        field,
        prefix: '',
        replace: { start: cursor, end: cursor },
        inGroup: g.inGroup,
      };
    }
    return { kind: 'none' };
  }

  // Cursor in whitespace (or at start/end). Look at the previous token.
  const prevIdx = lastIndexBefore(tokens, cursor);
  const prev = prevIdx >= 0 ? tokens[prevIdx]! : undefined;
  const replace = { start: cursor, end: cursor };

  if (!prev) return { kind: 'field-or-term', prefix: '', replace };

  if (OP_TYPES.has(prev.type)) {
    const field = fieldBefore(tokens, prevIdx);
    if (field !== undefined) {
      const g = groupInfo(tokens, prevIdx + 1);
      return { kind: 'value', field, prefix: '', replace, inGroup: g.inGroup };
    }
    return { kind: 'none' };
  }

  const g = groupInfo(tokens, prevIdx + 1);
  if (prev.type === 'lparen' || isKeyword(prev)) {
    if (g.inGroup && g.field !== undefined)
      return { kind: 'value', field: g.field, prefix: '', replace, inGroup: true };
    return { kind: 'field-or-term', prefix: '', replace };
  }
  // previous token completes a clause (term, quoted, rparen)
  return { kind: 'operator', prefix: '', replace };
}

// ---- helpers -----------------------------------------------------------------

function isKeyword(t: Token): boolean {
  return t.type === 'term' && KEYWORDS.has(t.value.toLowerCase());
}

function stripQuote(prefix: string, tok: Token): string {
  return tok.type === 'quoted' && prefix.startsWith('"') ? prefix.slice(1) : prefix;
}

/**
 * Field name that owns the operator token at `opIdx` (`field:` or `field>`), if any.
 * Walks back over the contiguous run (no whitespace) so `url:http://x|` resolves to `url`.
 */
function fieldBefore(tokens: Token[], opIdx: number): string | undefined {
  const op = tokens[opIdx];
  if (!op || op.precededBySpace) return undefined;
  let start = opIdx;
  while (start > 0 && !tokens[start]!.precededBySpace) start--;
  const f = tokens[start];
  const after = tokens[start + 1];
  if (f && f.type === 'term' && after && OP_TYPES.has(after.type) && start < opIdx) return f.value;
  return undefined;
}

function lastIndexBefore(tokens: Token[], cursor: number): number {
  let idx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.end <= cursor) idx = i;
    else break;
  }
  return idx;
}

/** Whether the token position `idx` sits inside an unmatched `field:(` group, and which field. */
function groupInfo(tokens: Token[], idx: number): { inGroup: boolean; field?: string } {
  const stack: (string | undefined)[] = [];
  for (let i = 0; i < idx && i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'lparen') {
      const prev = tokens[i - 1];
      stack.push(prev && prev.type === 'colon' ? fieldBefore(tokens, i - 1) : undefined);
    } else if (t.type === 'rparen') {
      stack.pop();
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    if (f !== undefined) return { inGroup: true, field: f };
  }
  return { inGroup: false };
}
