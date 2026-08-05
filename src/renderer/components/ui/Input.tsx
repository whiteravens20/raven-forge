import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const baseId =
    id ??
    label?.toLowerCase().replace(/\s+/g, '-') ??
    `input-${Math.random().toString(36).slice(2, 8)}`;
  const inputId = `${baseId}-field`;
  const errorId = `${baseId}-error`;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-rf-text-secondary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-lg border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-text placeholder:text-rf-text-muted outline-none focus:border-rf-accent focus:ring-1 focus:ring-rf-accent transition-colors ${
          error ? 'border-rf-danger focus:ring-rf-danger' : ''
        } ${className}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <span id={errorId} className="text-xs text-rf-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
