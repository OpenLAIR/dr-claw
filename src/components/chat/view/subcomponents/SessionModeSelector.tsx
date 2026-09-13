import React from 'react';
import type { SessionMode } from '../../../../types/app';

export interface SessionModeChoice {
  id: SessionMode;
  titleKey: string;
}

interface SessionModeSelectorProps {
  choices: SessionModeChoice[];
  activeMode: SessionMode;
  onSelect: (id: SessionMode) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function SessionModeSelector({
  choices,
  activeMode,
  onSelect,
  t,
}: SessionModeSelectorProps) {
  const isResearch = activeMode === 'research';
  
  const handleToggle = () => {
    const nextMode = isResearch ? 'workspace_qa' : 'research';
    onSelect(nextMode);
  };

  const activeChoice = choices.find((c) => c.id === activeMode) || choices[0];

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg border border-border/50 text-[10px] font-medium transition-all duration-150 ${
        isResearch 
          ? 'bg-primary/10 text-primary hover:bg-primary/15' 
          : 'bg-muted/60 text-muted-foreground hover:bg-muted/80'
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isResearch ? 'bg-sky-500' : 'bg-muted-foreground/40'}`} />
      <span>{t(activeChoice.titleKey)}</span>
    </button>
  );
}
