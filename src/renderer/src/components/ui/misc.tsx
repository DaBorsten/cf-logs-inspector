import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Toaster as SonnerToaster } from 'sonner';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/ui';
import { resolveTheme } from '../../app/theme';

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <Loader2
      className={cn('size-4 animate-spin text-muted-foreground', className)}
      aria-label="Loading"
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 p-6 text-center', className)}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Toaster(): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  return (
    <SonnerToaster
      theme={resolveTheme(theme)}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{ classNames: { toast: 'text-sm' } }}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
