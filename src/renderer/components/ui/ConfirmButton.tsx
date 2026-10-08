// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useState, type ReactNode } from 'react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';

interface ConfirmButtonProps {
  /** What the button says before it is pressed; leave out for an icon alone. */
  children?: ReactNode;
  icon?: ReactNode;
  title?: string;
  /** Asked in place of the button once it has been pressed. */
  question: string;
  /** The word on the button that goes through with it. */
  confirmLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}

/**
 * A button for something that cannot be taken back, which asks first.
 *
 * In place, the way restoring a world backup already asked: the question and
 * its two answers take the button's spot, so there is no dialog to open and
 * nothing happens on a first press. Deleting a backup, deleting the files a
 * profile left behind and removing a trusted key all went through on one click
 * — the first two delete worlds, and the third can switch signature checking
 * off.
 */
export function ConfirmButton({
  children,
  icon,
  title,
  question,
  confirmLabel,
  loading,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const t = useT();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button
        variant="danger"
        size="sm"
        icon={icon}
        title={title}
        loading={loading}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {children}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2" role="group">
      <span className="text-xs text-rf-danger">{question}</span>
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </Button>
    </span>
  );
}
