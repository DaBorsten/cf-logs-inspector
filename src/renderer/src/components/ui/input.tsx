import * as React from 'react';
import { cn } from '../../lib/utils';

export const inputClass =
  'flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputClass, className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClass, 'h-auto min-h-20 resize-y font-mono text-xs', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/** Native select styled like Input (grouped options work everywhere, including jsdom tests). */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(inputClass, 'pr-7', className)} {...props}>
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';
