import * as React from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-xs font-medium text-foreground/90 select-none', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export interface FieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
  className?: string;
}

/** Label + control + hint/error block. Pass the control's `id` so the label is associated. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  if (!children) return null;
  return (
    <p
      className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
      role="alert"
    >
      {children}
    </p>
  );
}
