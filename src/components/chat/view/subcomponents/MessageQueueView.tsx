import { useLayoutEffect, useRef, useState } from 'react';
import WorkbenchDialog from '../../../ui/WorkbenchDialog';
import { useTranslation } from 'react-i18next';
import type { useMessageQueue } from '../../hooks/useMessageQueue';
import { Button } from '../../../ui/button';

type Props = { queue: ReturnType<typeof useMessageQueue>; onFocusComposer: () => void };

export default function MessageQueueView({ queue, onFocusComposer }: Props) {
  const { t } = useTranslation('chat');
  const region = useRef<HTMLElement>(null);
  const [confirmResume, setConfirmResume] = useState(false);
  const ownsFocus = useRef(false);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => () => {
    if (region.current?.contains(document.activeElement) || (ownsFocus.current && document.activeElement === document.body)) requestAnimationFrame(onFocusComposer);
  }, []);
  const restoreFocus = (id: string) => requestAnimationFrame(() => {
    const trigger = editButtons.current.get(id);
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else if (region.current?.isConnected) region.current.focus();
    else onFocusComposer();
  });
  return (
    <section ref={region} onFocusCapture={() => { ownsFocus.current = true; }} onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) ownsFocus.current = false; }} tabIndex={-1} aria-label={t('queue.title')} className="border-b border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status">{t(queue.paused ? 'queue.paused' : 'queue.waiting', { count: queue.items.length })}</span>
        {queue.paused && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { if (queue.items.some(item => item.uncertain)) setConfirmResume(true); else queue.resume(); }}>{t('queue.resume')}</Button>}
      </div>
      {queue.restored && !queue.editing && <p className="my-2 text-xs text-muted-foreground">{t('queue.restored')}</p>}
      {queue.saving && <p role="status" className="sr-only">{t('queue.saving')}</p>}
      {queue.storageError && <div role="alert" className="my-2 space-y-1 text-sm"><p>{t(queue.restoring ? 'queue.restoreFailed' : 'queue.saveFailed')}</p><Button type="button" variant="outline" onClick={queue.retryStorage}>{t('queue.retryStorage')}</Button></div>}
      <ol className={`${queue.editing ? 'max-h-[min(16rem,35dvh)]' : 'max-h-32'} overflow-y-auto`}>
        {queue.items.map((item, index) => {
          const editing = queue.editing?.id === item.id;
          const busy = queue.dispatchingId === item.id;
          return (
            <li key={item.id} className="py-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={[item.text, item.promptTitle, ...item.files].filter(Boolean).join(' · ')}>{item.text || item.promptTitle || item.files.join(', ')}</span>
                {!editing && <>
                  <Button ref={node => { if (node) editButtons.current.set(item.id, node); else editButtons.current.delete(item.id); }}
                    type="button" variant="ghost" disabled={busy || Boolean(queue.editing)} aria-label={t('queue.edit', { number: index + 1 })}
                    onClick={() => queue.beginEdit(item.id)} className="min-h-11 shrink-0 px-2 text-xs">{t('queue.editLabel')}</Button>
                  <Button type="button" variant="ghost" disabled={busy} aria-label={t('queue.remove', { number: index + 1 })}
                    onClick={() => { queue.remove(item.id); restoreFocus(item.id); }} className="min-h-11 shrink-0 px-2 text-xs">{t('queue.removeLabel')}</Button>
                </>}
              </div>
              {!editing && item.files.length > 0 && <p className="text-xs text-muted-foreground" title={item.files.join(', ')}>{t('queue.files', { count: item.files.length })}</p>}
              {editing && <div data-queue-editor className="space-y-2 py-2" onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  event.preventDefault(); queue.cancelEdit(); restoreFocus(item.id);
                }
              }}>
                <textarea autoFocus aria-label={t('queue.edit', { number: index + 1 })} value={queue.editing!.text}
                  onChange={event => queue.updateEdit(event.target.value)} rows={3}
                  className="block min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
                <p className="text-xs text-muted-foreground">{t('queue.editHint')}</p>
                {item.files.length > 0 && <p className="break-words text-xs text-muted-foreground">{t('queue.files', { count: item.files.length })}: {item.files.join(', ')}</p>}
                {item.promptTitle && <p className="break-words text-xs text-muted-foreground">{item.promptTitle}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" className="min-h-11" onClick={() => { queue.cancelEdit(); restoreFocus(item.id); }}>{t('queue.cancelEdit')}</Button>
                  <Button type="button" className="min-h-11" disabled={!queue.editing!.text.trim() && !item.files.length && !item.hasPrompt}
                    onClick={() => { queue.saveEdit(); restoreFocus(item.id); }}>{t('queue.saveEdit')}</Button>
                </div>
              </div>}
            </li>
          );
        })}
      </ol>
      {confirmResume && <WorkbenchDialog title={t('queue.checkDelivery')} onClose={() => setConfirmResume(false)}><div className="space-y-4"><p className="text-sm">{t('queue.uncertain')}</p><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setConfirmResume(false)}>{t('queue.cancelEdit')}</Button><Button onClick={() => { setConfirmResume(false); queue.resume(); }}>{t('queue.sendAgain')}</Button></div></div></WorkbenchDialog>}
    </section>
  );
}
