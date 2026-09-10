/**
 * CodeMirror 6 support for DQL built on the shared tokenizer/parser: token-class highlighting (no
 * Lezer grammar needed for a one-line language), lint diagnostics and context-aware completion.
 * The pure helpers (`classifyTokens`, `dqlDiagnostics`, `completionOptions`) are unit-tested; the
 * extensions wrap them.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext as CmCompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { KEYWORDS, parse, tokenize, type CompletionContext } from '@shared/dql';
import { completionContextAt } from '@shared/dql';
import type { TokenType } from '@shared/dql/tokenizer';

// ---- highlighting -------------------------------------------------------------------------------

export type DqlTokenClass =
  'field' | 'operator' | 'keyword' | 'value' | 'quoted' | 'paren' | 'term' | 'error';

const OP_TYPES: ReadonlySet<TokenType> = new Set(['colon', 'gt', 'gte', 'lt', 'lte']);

/** Assigns a highlight class to every token (mirrors the parser's field/keyword rules). */
export function classifyTokens(input: string): { from: number; to: number; cls: DqlTokenClass }[] {
  const tokens = tokenize(input).filter((t) => t.type !== 'eof');
  return tokens.map((t, i) => {
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    let cls: DqlTokenClass;
    switch (t.type) {
      case 'lparen':
      case 'rparen':
        cls = 'paren';
        break;
      case 'quoted':
        cls = t.unterminated ? 'error' : 'quoted';
        break;
      case 'term': {
        const followedByOp = Boolean(next && OP_TYPES.has(next.type) && !next.precededBySpace);
        const afterOp = Boolean(prev && OP_TYPES.has(prev.type) && !t.precededBySpace);
        // A token glued to a preceding operator continues the value run (`url:http://x`), even when
        // another operator follows without whitespace.
        if (afterOp) cls = 'value';
        else if (followedByOp) cls = 'field';
        else if (KEYWORDS.has(t.value.toLowerCase()) && !t.text.includes('\\')) cls = 'keyword';
        else cls = 'term';
        break;
      }
      default:
        cls = 'operator';
    }
    return { from: t.start, to: t.end, cls };
  });
}

const marks: Record<DqlTokenClass, Decoration> = {
  field: Decoration.mark({ class: 'cm-dql-field' }),
  operator: Decoration.mark({ class: 'cm-dql-operator' }),
  keyword: Decoration.mark({ class: 'cm-dql-keyword' }),
  value: Decoration.mark({ class: 'cm-dql-value' }),
  quoted: Decoration.mark({ class: 'cm-dql-quoted' }),
  paren: Decoration.mark({ class: 'cm-dql-paren' }),
  term: Decoration.mark({ class: 'cm-dql-term' }),
  error: Decoration.mark({ class: 'cm-dql-error' }),
};

function buildDecorations(view: EditorView): DecorationSet {
  const ranges = classifyTokens(view.state.doc.toString())
    .filter((r) => r.to > r.from)
    .map((r) => marks[r.cls].range(r.from, r.to));
  return Decoration.set(ranges, true);
}

export const dqlHighlight: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- lint ---------------------------------------------------------------------------------------

export function dqlDiagnostics(text: string): Diagnostic[] {
  if (!text.trim()) return [];
  const result = parse(text);
  if (result.ok) return [];
  const from = Math.min(result.error.start, text.length);
  const to = Math.min(Math.max(result.error.end, from + 1), Math.max(text.length, from + 1));
  return [
    {
      from,
      to: Math.max(to, from),
      severity: 'error',
      message: result.error.hint
        ? `${result.error.message}. ${result.error.hint}`
        : result.error.message,
    },
  ];
}

export const dqlLint: Extension = linter((view) => dqlDiagnostics(view.state.doc.toString()), {
  delay: 150,
});

// ---- completion ---------------------------------------------------------------------------------

export interface CompletionDeps {
  /** Field names (fixed + discovered props). */
  fields: () => string[];
  /** Distinct values for a field, narrowed by prefix. */
  values: (field: string, prefix: string) => Promise<string[]>;
}

const NEEDS_QUOTES = /[\s():<>"\\*]/;

export function quoteValue(v: string): string {
  return NEEDS_QUOTES.test(v) || v === '' ? `"${v.replace(/(["\\])/g, '\\$1')}"` : v;
}

const KEYWORD_OPTIONS: Completion[] = ['and', 'or', 'not'].map((k) => ({
  label: k,
  type: 'keyword',
  apply: `${k} `,
  boost: -1,
}));

/** Options for a completion context; `quotedContext` means the user already typed an opening quote. */
export async function completionOptions(
  ctx: CompletionContext,
  deps: CompletionDeps,
  quotedContext = false,
): Promise<Completion[]> {
  switch (ctx.kind) {
    case 'none':
      return [];
    case 'operator':
      return [...KEYWORD_OPTIONS];
    case 'field-or-term': {
      const fields = deps.fields().map<Completion>((f) => ({
        label: f,
        type: 'property',
        apply: `${f}:`,
        detail: 'field',
      }));
      return [...fields, { label: 'not', type: 'keyword', apply: 'not ', boost: -1 }];
    }
    case 'value': {
      let values: string[] = [];
      try {
        values = await deps.values(ctx.field, ctx.prefix);
      } catch {
        values = [];
      }
      const opts = values.map<Completion>((v) => {
        const text = quotedContext ? `"${v.replace(/(["\\])/g, '\\$1')}"` : quoteValue(v);
        return { label: quotedContext ? text : v, type: 'text', apply: text };
      });
      if (!quotedContext) opts.push({ label: '*', type: 'text', detail: 'exists', boost: -2 });
      return opts;
    }
  }
}

export function dqlCompletionSource(deps: CompletionDeps): CompletionSource {
  return async (cm: CmCompletionContext): Promise<CompletionResult | null> => {
    const text = cm.state.doc.toString();
    const ctx = completionContextAt(text, cm.pos);
    if (ctx.kind === 'none') return null;
    // Do not pop up on every space; only when typing a prefix, right after an operator, or on demand.
    if (!cm.explicit && ctx.prefix === '' && ctx.kind !== 'value') return null;
    const quoted = ctx.kind === 'value' && text[ctx.replace.start] === '"';
    const options = await completionOptions(ctx, deps, quoted);
    if (options.length === 0) return null;
    return {
      from: ctx.replace.start,
      to: Math.max(ctx.replace.end, cm.pos),
      options,
      validFor: quoted ? /^"[^"]*"?$/ : /^[\w.@*/-]*$/,
    };
  };
}

export function dqlAutocompletion(deps: CompletionDeps): Extension {
  return autocompletion({
    override: [dqlCompletionSource(deps)],
    activateOnTyping: true,
    icons: false,
    maxRenderedOptions: 30,
  });
}

// ---- single line --------------------------------------------------------------------------------

/** Rejects newlines (pastes are flattened to spaces) so the editor stays one line. */
export const singleLine: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  let hasNewline = false;
  tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
    if (inserted.toString().includes('\n')) hasNewline = true;
  });
  if (!hasNewline) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/\r?\n/g, ' ') });
  });
  return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView }];
});

/** Editor chrome: one line, mono font, colours from the Tailwind theme variables. */
export const dqlTheme: Extension = EditorView.theme({
  '&': { fontSize: '12px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px', overflow: 'hidden' },
  '.cm-content': { padding: '5px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-placeholder': { color: 'var(--muted-foreground)', fontStyle: 'normal' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    borderRadius: '6px',
    fontSize: '12px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'normal' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--destructive)',
    textUnderlineOffset: '3px',
  },
  '.cm-dql-field': { color: 'var(--primary)' },
  '.cm-dql-operator': { color: 'var(--muted-foreground)' },
  '.cm-dql-keyword': { color: 'var(--warning)', fontWeight: '600' },
  '.cm-dql-value': { color: 'var(--foreground)' },
  '.cm-dql-quoted': { color: 'var(--success)' },
  '.cm-dql-paren': { color: 'var(--muted-foreground)' },
  '.cm-dql-error': { color: 'var(--destructive)' },
});
