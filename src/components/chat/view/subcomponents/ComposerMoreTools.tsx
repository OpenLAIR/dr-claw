import { createContext, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../../hooks/useDeviceSettings';

export const ComposerToolsContext = createContext<() => void>(() => {});

/** One tool list: anchored nonmodal popover on desktop, modal bottom sheet on touch layouts. */
export default function ComposerMoreTools({ children }: { children: ReactNode }) {
  const { t } = useTranslation('chat');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel || !open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (isMobile) { panel.style.left = ''; panel.style.bottom = ''; return; }
      if (!anchor) return;
      panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - 288))}px`;
      panel.style.bottom = `${Math.max(8, innerHeight - anchor.top + 8)}px`;
    };
    place();
    if (isMobile) panel.showModal(); else panel.show();
    panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest('dialog') && target.closest('dialog') !== panel) return;
      if (!panel.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog:modal')) {
        event.preventDefault(); setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    return () => {
      panel.close();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open, isMobile]);
  return <>
    <button ref={trigger} type="button" aria-label={t('input.moreTools')} title={t('input.moreTools')}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}
      className="chat-composer-action">
      <MoreHorizontal className="h-5 w-5" />
    </button>
    {createPortal(<dialog ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}
      className={`composer-more-tools m-0 border border-border bg-popover text-popover-foreground shadow-lg ${isMobile ? 'fixed inset-x-0 bottom-0 top-auto w-full max-w-none rounded-t-xl pb-[env(safe-area-inset-bottom)]' : 'fixed top-auto z-50 w-[280px] rounded-lg'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1">
        <h2 id={titleId} className="text-sm font-medium">{t('input.moreTools')}</h2>
        <button type="button" aria-label={t('common:buttons.close')} onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="composer-tool-list max-h-[60dvh] space-y-1 overflow-y-auto p-2 [&>div>button]:w-full [&>div>button]:justify-start [&>button]:min-h-11"><ComposerToolsContext.Provider value={close}>{children}</ComposerToolsContext.Provider></div>
    </dialog>, document.body)}
  </>;
}
