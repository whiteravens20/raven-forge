import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-rf-accent hover:bg-rf-accent-hover text-white',
  secondary: 'bg-rf-surface hover:bg-rf-bg-tertiary text-rf-text border border-rf-border',
  danger: 'bg-rf-danger/10 hover:bg-rf-danger/20 text-rf-danger border border-rf-danger/30',
  ghost: 'hover:bg-rf-surface text-rf-text-secondary',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5 rounded',
  md: 'px-4 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-6 py-2.5 text-sm gap-2 rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-rf-accent focus:ring-offset-1 focus:ring-offset-rf-bg ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
