import * as React from 'react';

const INDENT = '  ';

/** Plain, read-only pretty-printed JSON with syntax highlighting — no filter or copy actions. */
export function JsonPlain({ value }: { value: unknown }): React.JSX.Element {
  return (
    <pre className="font-mono text-[12px] leading-5 break-all whitespace-pre-wrap">
      {renderJson(value, 0)}
    </pre>
  );
}

function Punct({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-muted-foreground">{children}</span>;
}

function renderJson(value: unknown, depth: number): React.ReactNode {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'string')
    return <span className="text-success">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="text-warning">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-destructive">{String(value)}</span>;

  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return <Punct>[]</Punct>;
    return (
      <>
        <Punct>[</Punct>
        {'\n'}
        {value.map((v, i) => (
          <React.Fragment key={i}>
            {pad}
            {renderJson(v, depth + 1)}
            {i < value.length - 1 ? <Punct>,</Punct> : null}
            {'\n'}
          </React.Fragment>
        ))}
        {closePad}
        <Punct>]</Punct>
      </>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <Punct>{'{}'}</Punct>;
  return (
    <>
      <Punct>{'{'}</Punct>
      {'\n'}
      {entries.map(([k, v], i) => (
        <React.Fragment key={k}>
          {pad}
          <span className="text-primary">{JSON.stringify(k)}</span>
          <Punct>: </Punct>
          {renderJson(v, depth + 1)}
          {i < entries.length - 1 ? <Punct>,</Punct> : null}
          {'\n'}
        </React.Fragment>
      ))}
      {closePad}
      <Punct>{'}'}</Punct>
    </>
  );
}
