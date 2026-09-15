import * as React from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { FIXED_FIELDS } from '@shared/model/fields';
import { cn } from '../../lib/utils';

/** Opens a reference popup explaining the DQL filter syntax accepted by the query bar. */
export function DqlHelpDialog({ className }: { className?: string }): React.JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn(className)}
          aria-label="DQL syntax help"
          title="DQL syntax help"
        >
          DQL
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>DQL query syntax</DialogTitle>
          <DialogDescription>
            Filter log entries with a small query language. Press <Code>Ctrl+Space</Code> in the
            query bar for field/value completion.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5 overflow-y-auto pr-1 text-xs">
          <Section title="Free text">
            <p>
              A bare word or phrase searches <Code>message</Code> (and <Code>raw</Code>).
            </p>
            <ExampleList
              examples={[
                { code: 'timeout', note: 'entries whose message contains "timeout"' },
                { code: '"connection refused"', note: 'exact phrase, case-insensitive' },
              ]}
            />
          </Section>

          <Section title="Field filters">
            <p>
              <Code>field:value</Code> matches an exact value on keyword/number/date fields, or a
              substring on text fields (<Code>message</Code>, <Code>raw</Code>). Matching is
              case-insensitive.
            </p>
            <ExampleList
              examples={[
                { code: 'level:ERROR', note: 'exact level match' },
                { code: 'app:checkout-*', note: 'wildcard match (unquoted values only)' },
                { code: 'message:"out of memory"', note: 'quoted phrase' },
                { code: 'labels.tenant:acme', note: 'dynamic JSON property, dotted path' },
                { code: 'field:*', note: 'field exists / is not empty' },
              ]}
            />
          </Section>

          <Section title="Combining clauses">
            <p>
              Use <Code>and</Code>, <Code>or</Code>, <Code>not</Code> (case-insensitive) and{' '}
              <Code>( )</Code> for grouping. Clauses written next to each other with no keyword are
              combined with <Code>and</Code>.
            </p>
            <ExampleList
              examples={[
                { code: 'level:ERROR and app:checkout', note: 'explicit and' },
                { code: 'level:ERROR app:checkout', note: 'same as above — implicit and' },
                { code: 'level:ERROR or level:WARN', note: 'either level' },
                { code: 'not level:DEBUG', note: 'negation' },
                {
                  code: 'level:ERROR and (app:checkout or app:payments)',
                  note: 'grouping with parentheses',
                },
                { code: 'app:(checkout or payments)', note: 'value group scoped to one field' },
              ]}
            />
          </Section>

          <Section title="Ranges">
            <p>
              Use <Code>&gt;</Code>, <Code>&gt;=</Code>, <Code>&lt;</Code>, <Code>&lt;=</Code>{' '}
              directly after a field name, or after <Code>:</Code>.
            </p>
            <ExampleList
              examples={[
                { code: 'bytes>1000', note: 'numeric comparison' },
                { code: 'bytes:(>100 and <200)', note: 'range group' },
                { code: 'timestamp>=2026-01-01T00:00:00Z', note: 'date comparison (ISO 8601)' },
              ]}
            />
          </Section>

          <Section title="Fields">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="border-b py-1 pr-2 font-medium">Field</th>
                  <th className="border-b py-1 pr-2 font-medium">Aliases</th>
                  <th className="border-b py-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {FIXED_FIELDS.map((f) => (
                  <tr key={f.id}>
                    <td className="py-1 pr-2 font-mono">{f.id}</td>
                    <td className="py-1 pr-2 font-mono text-muted-foreground">
                      {f.aliases.join(', ') || '—'}
                    </td>
                    <td className="py-1 text-muted-foreground">{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-muted-foreground">
              Any other name (e.g. <Code>labels.tenant</Code>) looks up a property inside the log
              entry's JSON payload.
            </p>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>;
}

function ExampleList({
  examples,
}: {
  examples: { code: string; note: string }[];
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {examples.map((e) => (
        <li key={e.code} className="flex flex-wrap items-baseline gap-x-2">
          <Code>{e.code}</Code>
          <span className="text-muted-foreground">{e.note}</span>
        </li>
      ))}
    </ul>
  );
}
