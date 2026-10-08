// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useId, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  // React's own, so that it is the same from one render to the next and no two
  // fields share it. It used to be made from the label — two fields labelled
  // "Port" were one id — or, with no label, afresh at every render.
  const generated = useId();
  const baseId = id ?? generated;
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
        className={`rounded-lg border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-text placeholder:text-rf-text-muted outline-none focus:border-rf-accent-text focus:ring-1 focus:ring-rf-accent-text transition-colors ${
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
