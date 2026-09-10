/**
 * DQL (OpenSearch Dashboards Query Language subset) abstract syntax tree.
 * Shared by the parser, the in-memory evaluator (renderer/tests) and the SQL compiler (main).
 */

export interface Span {
  start: number;
  end: number;
}

export interface FieldRef {
  /** Field name as written, unescaped, e.g. "labels.tenant" or "labels.*". */
  name: string;
  /** Dot-separated path segments. */
  path: string[];
  /** True when the name contains a `*` wildcard (every `*` is a wildcard in field names). */
  hasWildcard: boolean;
  span?: Span;
}

export interface Literal {
  /** Unescaped literal text. For wildcard literals this is the text with `*` in place. */
  raw: string;
  quoted: boolean;
  /** True only for unquoted literals containing at least one unescaped `*`. */
  hasWildcard: boolean;
  /**
   * Present iff `hasWildcard`: literal text fragments between wildcards (already unescaped),
   * so `a\*b*c` becomes `["a*b", "c"]`. Lets compilers emit LIKE/regex without re-escaping.
   */
  segments?: string[];
  span?: Span;
}

export type RangeOp = '>' | '>=' | '<' | '<=';

export type DqlNode =
  | { type: 'match_all' }
  | { type: 'and'; children: DqlNode[]; span?: Span }
  | { type: 'or'; children: DqlNode[]; span?: Span }
  | { type: 'not'; child: DqlNode; span?: Span }
  /** Free text; matches against the configured text fields (default: message). */
  | { type: 'term'; value: Literal; span?: Span }
  /** `field:value` or `field:"phrase"`. */
  | { type: 'match'; field: FieldRef; value: Literal; span?: Span }
  /** `field:*` */
  | { type: 'exists'; field: FieldRef; span?: Span }
  /** `field>10`, `field:>=10` */
  | { type: 'range'; field: FieldRef; op: RangeOp; value: Literal; span?: Span };

export type DqlNodeType = DqlNode['type'];

/**
 * Operator used when two clauses are adjacent without an explicit `and`/`or`.
 * DQL proper defaults to `or`; for log filtering `and` is what users mean, so we diverge on purpose.
 */
export const DEFAULT_OPERATOR: 'and' | 'or' = 'and';

export const KEYWORDS = new Set(['and', 'or', 'not']);
