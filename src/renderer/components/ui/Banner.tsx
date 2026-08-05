import { AlertTriangle, Info, AlertCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@renderer/i18n';

type BadgeType = 'info' | 'warning' | 'urgent' | 'success';

interface BadgeProps {
  type: BadgeType;
  children: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const styles: Record<BadgeType, string> = {
  info: 'bg-rf-accent/10 border-rf-accent/30 text-rf-accent',
  warning: 'bg-rf-warning/10 border-rf-warning/30 text-rf-warning',
  urgent: 'bg-rf-danger/10 border-rf-danger/30 text-rf-danger',
  success: 'bg-rf-success/10 border-rf-success/30 text-rf-success',
};

const icons: Record<BadgeType, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  urgent: AlertCircle,
  success: Info,
};

export function Banner({ type, children, dismissible, onDismiss }: BadgeProps) {
  const Icon = icons[type];
  const t = useT();

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${styles[type]}`}
      role={type === 'urgent' ? 'alert' : 'status'}
      aria-live={type === 'urgent' ? 'assertive' : 'polite'}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">{children}</span>
      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-current"
          aria-label={t('common.dismiss')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
