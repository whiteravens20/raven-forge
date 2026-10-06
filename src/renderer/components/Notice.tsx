// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { Banner } from '@components/ui/Banner';
import { useNoticeStore } from '@stores/notice-store';

/** The window's one line for a failure that belongs to no page in particular. */
export function Notice() {
  const message = useNoticeStore((s) => s.message);
  const clear = useNoticeStore((s) => s.clear);

  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex justify-center px-6">
      <div className="pointer-events-auto max-w-xl select-text shadow-xl">
        <Banner type="warning" dismissible onDismiss={clear}>
          {message}
        </Banner>
      </div>
    </div>
  );
}
