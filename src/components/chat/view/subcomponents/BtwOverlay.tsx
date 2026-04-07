import React, { useEffect } from 'react';
import { Markdown } from './Markdown';

export type BtwOverlayState = {
  open: boolean;
  question: string;
  answer: string;
  loading: boolean;
  error: string | null;
};

type BtwOverlayProps = {
  state: BtwOverlayState;
  onClose: () => void;
};

export default function BtwOverlay({ state, onClose }: BtwOverlayProps) {
  const { open, question, answer, loading, error } = state;

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="btw-overlay-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg max-h-[min(80vh,560px)] flex flex-col rounded-2xl border border-border/60 bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 border-b border-border/40">
          <div className="min-w-0">
            <h2 id="btw-overlay-title" className="text-sm font-semibold text-foreground">
              Side question
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Esc to close · not saved to chat</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 text-sm text-foreground/90 border-b border-border/30 bg-muted/20">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Question</span>
          <p className="mt-1 whitespace-pre-wrap break-words">{question}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm min-h-[120px]">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-block h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Thinking…
            </div>
          )}
          {!loading && error && <p className="text-destructive whitespace-pre-wrap">{error}</p>}
          {!loading && !error && answer && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Markdown>{answer}</Markdown>
            </div>
          )}
          {!loading && !error && !answer && <p className="text-muted-foreground">No response.</p>}
        </div>
      </div>
    </div>
  );
}
