import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';

/** Native modal provides focus containment, Escape handling and an inert background. */
export default function WorkbenchDialog({ title, onClose, children, size = 'default' }: { title: string; onClose: () => void; children: ReactNode; size?: 'default' | 'wide' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useTranslation('common');
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);
  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} style={{ width: 'calc(100% - 32px)' }} className={`workbench-dialog ${size === 'wide' ? 'max-w-[1000px]' : 'max-w-[480px]'} max-h-[85dvh] overflow-y-auto rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><h2 id={titleId} className="text-base font-semibold">{title}</h2><Button variant="ghost" size="icon" onClick={onClose} aria-label={t('buttons.close')}><X /></Button></div>
      <div className="p-5">{children}</div>
    </dialog>, document.body,
  );
}
