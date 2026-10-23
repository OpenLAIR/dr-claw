import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, X, FlaskConical, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AttachedPrompt } from '../../types/types';

interface PromptBadgeDropdownProps {
  prompt: AttachedPrompt;
  onRemove: () => void;
  onUpdate: (text: string) => void;
}

export default function PromptBadgeDropdown({ prompt, onRemove, onUpdate }: PromptBadgeDropdownProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [editText, setEditText] = useState(prompt.promptText);

  // Sync editText only when switching to a different scenario
  useEffect(() => {
    setEditText(prompt.promptText);
  }, [prompt.scenarioId]);

  const handleBlur = useCallback(() => {
    if (editText !== prompt.promptText) {
      onUpdate(editText);
    }
  }, [editText, prompt.promptText, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  return (
    <div className="px-3 pt-2.5 pb-1">
      {/* Badge chip */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted border border-border text-sm">
        {prompt.scenarioId.startsWith('autoresearch-') ? <FlaskConical className="h-4 w-4 shrink-0" /> : <Sparkles className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 break-words font-medium text-foreground text-xs">{prompt.scenarioTitle}</span>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="ml-0.5 p-0.5 hover:bg-primary/10 rounded transition-colors"
          aria-expanded={isOpen}
          aria-controls="prompt-edit-area"
          title={isOpen ? t('attachedPrompt.hidePrompt') : t('attachedPrompt.showPrompt')}
        >
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 hover:bg-destructive/10 rounded transition-colors"
          title={t('attachedPrompt.remove')}
        >
          <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>

      {/* Dropdown editable area */}
      {isOpen && (
        <div className="mt-2 mb-1" id="prompt-edit-area">
          <textarea
            aria-label={t('attachedPrompt.showPrompt')}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full p-2 text-sm bg-muted/30 border border-border/40 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/20 text-foreground/80 min-h-[36px] max-h-[80px] overflow-y-auto"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
