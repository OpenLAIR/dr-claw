import { useEffect, useId, useRef } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';

/** One editor across breakpoints avoids hidden inputs stealing autofocus. */
export default function SidebarRenameEditor({ label, value, onChange, onSave, onCancel, feedback, t }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  feedback: { pending: boolean; error: string };
  t: TFunction;
}) {
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!feedback.pending) input.current?.focus({ preventScroll: true });
  }, [feedback.pending]);
  useEffect(() => {
    const editor = container.current;
    const header = editor?.closest('[data-sidebar-content]')?.querySelector('[data-sidebar-header]');
    if (editor && header) {
      editor.style.scrollMarginTop = getComputedStyle(header).position === 'sticky'
        ? `${header.getBoundingClientRect().height + 8}px` : '0px';
    }
    editor?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [feedback.error]);
  return (
    <div ref={container} className="min-w-0 scroll-mt-56 space-y-2 p-2 md:scroll-mt-0" aria-busy={feedback.pending || undefined}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && !feedback.pending) { event.preventDefault(); onCancel(); }
      }}>
      <input ref={input} aria-label={label} value={value} readOnly={feedback.pending}
        aria-invalid={!!feedback.error} aria-describedby={feedback.error ? errorId : undefined}
        onChange={event => onChange(event.target.value)} autoComplete="off"
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (!feedback.pending) onSave();
          }
        }}
        className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
      {feedback.error && <p id={errorId} role="alert" className="text-sm text-destructive">{feedback.error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button className="h-11" variant="outline" disabled={feedback.pending} onClick={onCancel}>{t('actions.cancel')}</Button>
        <Button className="h-11" disabled={feedback.pending} onClick={onSave}>{t(feedback.pending ? 'actions.saving' : 'actions.save')}</Button>
      </div>
    </div>
  );
}
