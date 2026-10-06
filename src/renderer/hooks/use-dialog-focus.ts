// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep the keyboard inside a dialog for as long as it is open.
 *
 * A dialog opened over the page and left the focus on the button behind it: the
 * next Tab went on through the page underneath, where nothing could be seen,
 * and closing the dialog put the focus nowhere at all. This moves it in when
 * the dialog opens, turns Tab around at either end, and hands the focus back to
 * whatever had it once the dialog is gone.
 *
 * The element the ref goes on needs `tabIndex={-1}`: it is what takes the focus
 * when nothing inside asked for it with `autoFocus`.
 */
export function useDialogFocus<T extends HTMLElement>(): RefObject<T | null> {
  const dialog = useRef<T>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Something inside may have taken it already — a field with `autoFocus`.
    if (!node.contains(document.activeElement)) node.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (stops.length === 0) {
        event.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);

  return dialog;
}
