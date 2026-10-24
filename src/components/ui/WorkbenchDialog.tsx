import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';

/** Native modal provides focus containment, Escape handling and an inert background. */
export default function WorkbenchDialog({ title, onClose, children, size = 'default', busy = false }: { title: string; onClose: () => void; children: ReactNode; size?: 'default' | 'wide'; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useTranslation('common');
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);
  useEffect(() => {
    // All actions can be disabled during a mutation; keep focus inside the
    // dialog instead of leaving it on a disabled control or the page body.
    if (busy) ref.current?.focus({ preventScroll: true });
  }, [busy]);
  return createPortal(
    <dialog ref={ref} tabIndex={-1} aria-busy={busy || undefined} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }} style={{ width: 'calc(100% - 32px)' }} className={`workbench-dialog ${size === 'wide' ? 'max-w-[1000px]' : 'max-w-[480px]'} max-h-[85dvh] overflow-y-auto rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><h2 id={titleId} className="text-base font-semibold">{title}</h2><Button variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0" disabled={busy} onClick={onClose} aria-label={t('buttons.close')}><X /></Button></div>
      <div className="p-5">{children}</div>
    </dialog>, document.body,
  );
}
