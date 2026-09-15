import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Small tab-styled single-select group (`role="tablist"` of `role="tab"` buttons). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      className={cn('flex items-center rounded-md border p-0.5', className)}
      role="tablist"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={cn(
            'rounded px-2 py-0.5 text-[11px]',
            value === o.value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
