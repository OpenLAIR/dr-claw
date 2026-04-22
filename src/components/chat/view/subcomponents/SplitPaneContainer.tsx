import React, { useCallback, useRef, useState } from 'react';
import { useSessionTabsStore } from '../../../../stores/useSessionTabsStore';
import type { ChatInterfaceProps } from '../../types/types';
import type { ProjectSession } from '../../../../types/app';

interface SplitPaneContainerProps {
  ChatInterfaceComponent: React.ComponentType<ChatInterfaceProps>;
  baseChatProps: ChatInterfaceProps;
  /** All projects for resolving each tab's project */
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

/**
 * Renders one ChatInterface instance per open tab and keeps them ALL mounted.
 * Switching tabs is a pure CSS display toggle — no unmount/remount, no API reload.
 *
 * Layout:
 *  - Non-split: active tab is `position:absolute; inset:0`, all others are `display:none`.
 *  - Split:     primary (left) and secondary (right) are positioned absolutely;
 *               all other tabs are `display:none`.
 *
 * The draggable divider is rendered as a separate absolutely-positioned element
 * so it doesn't affect the tab instances' layout.
 */
export default function SplitPaneContainer({
  ChatInterfaceComponent,
  baseChatProps,
  projects,
}: SplitPaneContainerProps) {
  const tabs = useSessionTabsStore((s) => s.tabs);
  const activeTabId = useSessionTabsStore((s) => s.activeTabId);
  const splitMode = useSessionTabsStore((s) => s.splitMode);
  const secondaryTabId = useSessionTabsStore((s) => s.secondaryTabId);

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

  // No tabs yet (initial load before any session is selected).
  if (tabs.length === 0) {
    return <ChatInterfaceComponent {...baseChatProps} />;
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-w-0 overflow-hidden">
      {tabs.map((tab) => {
        const isPrimary = tab.id === activeTabId;
        const isSecondary = splitMode && tab.id === secondaryTabId;

        // Resolve the project for this specific tab.
        const tabProject =
          (projects.find((p) => p.name === tab.projectName) as ChatInterfaceProps['selectedProject']) ??
          baseChatProps.selectedProject;

        // Compute CSS positioning for this pane.
        let paneStyle: React.CSSProperties;
        if (!isPrimary && !isSecondary) {
          // Hidden: keep mounted but invisible (display:none preserves scroll & state).
          paneStyle = { display: 'none' };
        } else if (!splitMode) {
          // Single-pane: fill the entire container.
          paneStyle = { position: 'absolute', inset: 0 };
        } else if (isPrimary) {
          // Left pane: 0 → splitRatio%, with 2 px gap for the divider.
          paneStyle = {
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            right: `calc(${100 - splitRatio}% + 2px)`,
          };
        } else {
          // Right pane: splitRatio% → 100%, with 2 px gap for the divider.
          paneStyle = {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: `calc(${splitRatio}% + 2px)`,
          };
        }

        // Props overrides for each tab instance.
        // Session-specific reactive props (external file changes, intake flows)
        // only go to the active primary tab to avoid cross-instance interference.
        const tabChatProps: ChatInterfaceProps = {
          ...baseChatProps,
          selectedProject: tabProject,
          selectedSession: tab.session,
          externalMessageUpdate: isPrimary ? baseChatProps.externalMessageUpdate : 0,
          pendingAutoIntake: isPrimary ? baseChatProps.pendingAutoIntake : null,
          importedProjectAnalysisPrompt: isPrimary
            ? baseChatProps.importedProjectAnalysisPrompt
            : null,
        };

        return (
          <div key={tab.tabKey} style={paneStyle} className="overflow-hidden">
            <ChatInterfaceComponent {...tabChatProps} />
          </div>
        );
      })}

      {/* Draggable divider — absolutely positioned, above all panes (z-10). */}
      {splitMode && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${splitRatio}%`,
            width: 4,
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
          className="cursor-col-resize hover:bg-primary/20 active:bg-primary/30 bg-border/30 transition-colors"
          onMouseDown={handleResizeStart}
        />
      )}
    </div>
  );
}
