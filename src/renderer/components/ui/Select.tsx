import type { SelectHTMLAttributes } from 'react';

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
      <select
        id={selectId}
        className={`rounded-lg border bg-rf-surface px-3 py-2 text-sm text-rf-text outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${
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
      {error && (
        <span id={errorId} className="text-xs text-rf-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
