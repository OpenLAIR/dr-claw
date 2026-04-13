import React, { useCallback, useRef, useState } from 'react';
import { useSessionTabsStore } from '../../../../stores/useSessionTabsStore';
import type { ChatInterfaceProps } from '../../types/types';
import type { ProjectSession } from '../../../../types/app';

interface SplitPaneContainerProps {
  ChatInterfaceComponent: React.ComponentType<ChatInterfaceProps>;
  baseChatProps: ChatInterfaceProps;
  /** All projects for resolving secondary tab's project */
  projects: Array<{ name: string; sessions?: ProjectSession[]; [k: string]: unknown }>;
}

const SPLIT_MIN_WIDTH_PCT = 25;
const SPLIT_MAX_WIDTH_PCT = 75;
const SPLIT_STORAGE_KEY = 'dr-claw-split-ratio';

function readStoredRatio(): number {
  if (typeof window === 'undefined') return 50;
  const v = window.localStorage.getItem(SPLIT_STORAGE_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= SPLIT_MIN_WIDTH_PCT && n <= SPLIT_MAX_WIDTH_PCT ? n : 50;
}

export default function SplitPaneContainer({
  ChatInterfaceComponent,
  baseChatProps,
  projects,
}: SplitPaneContainerProps) {
  const splitMode = useSessionTabsStore((s) => s.splitMode);
  const secondaryTabId = useSessionTabsStore((s) => s.secondaryTabId);
  const secondaryTab = useSessionTabsStore((s) => s.tabs.find((t) => t.id === secondaryTabId));

  const [splitRatio, setSplitRatio] = useState(readStoredRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(SPLIT_MAX_WIDTH_PCT, Math.max(SPLIT_MIN_WIDTH_PCT, pct)));
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSplitRatio((r) => {
        window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(r)));
        return r;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  if (!splitMode || !secondaryTab) {
    return <ChatInterfaceComponent {...baseChatProps} />;
  }

  const secondaryProject = projects.find((p) => p.name === secondaryTab.projectName) ?? baseChatProps.selectedProject;

  const secondaryProps: ChatInterfaceProps = {
    ...baseChatProps,
    selectedProject: secondaryProject as ChatInterfaceProps['selectedProject'],
    selectedSession: secondaryTab.session,
  };

  return (
    <div ref={containerRef} className="flex h-full w-full min-w-0">
      <div className="min-w-0 overflow-hidden" style={{ width: `${splitRatio}%` }}>
        <ChatInterfaceComponent {...baseChatProps} />
      </div>

      <div
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 bg-border/30 transition-colors"
        onMouseDown={handleResizeStart}
      />

      <div className="min-w-0 overflow-hidden flex-1">
        <ChatInterfaceComponent {...secondaryProps} />
      </div>
    </div>
  );
}
