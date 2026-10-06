// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  /** Also used for "there is nothing valid to choose here", not only for faults. */
  error?: string;
}

export function Select({ label, options, error, className = '', id, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const errorId = `${selectId}-error`;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-rf-text-secondary">
          {label}
        </label>
      )}
      {/* The native arrow is switched off so the control matches the fields
          around it, and one is drawn in its place: without it this was a text
          field to look at, and nothing said it opens. */}
      <div className="relative">
        <select
          id={selectId}
          className={`w-full rounded-lg border bg-rf-surface py-2 pl-3 pr-9 text-sm text-rf-text outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${
            error
              ? 'border-rf-danger focus:border-rf-danger'
              : 'border-rf-border focus:border-rf-accent-text'
          } ${className}`}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-rf-text-muted"
        />
      </div>
      {error && (
        <span id={errorId} className="text-xs text-rf-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
