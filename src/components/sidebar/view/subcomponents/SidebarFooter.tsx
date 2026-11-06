import { useId, useState } from 'react';
import type { ComponentType } from 'react';
import {
  ArrowUpCircle,
  Blocks,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  LogOut,
  Monitor,
  Newspaper,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import { cn } from '../../../../lib/utils';

const EXPANDED_KEY = 'dr-claw.sidebarFooter.expanded';

const readExpanded = () => {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
};

type SidebarFooterProps = {
  activeTab: AppTab;
  onOpenNews: () => void;
  onOpenSkills: () => void;
  onOpenAutoResearch: () => void;
  onOpenCompute: () => void;
  onOpenTrash: () => void;
  currentVersion: string;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onLogout?: () => void;
  t: TFunction;
};

type FooterLink = { id: string; label: string; Icon: ComponentType<{ className?: string }>; action: () => void };

const rowClass = 'flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Tools, trash, settings and sign-out are used less often than projects, so
 * they fold behind one "Tools & settings" row. An available update stays
 * visible either way.
 */
export default function SidebarFooter({
  activeTab,
  onOpenNews,
  onOpenSkills,
  onOpenAutoResearch,
  onOpenCompute,
  onOpenTrash,
  currentVersion,
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  onLogout,
  t,
}: SidebarFooterProps) {
  const [expanded, setExpanded] = useState(readExpanded);
  const panelId = useId();

  const toggle = () => {
    setExpanded((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      } catch {
        // Still toggles for this session.
      }
      return next;
    });
  };

  const tools: FooterLink[] = [
    { id: 'news', label: t('common:tabs.news'), Icon: Newspaper, action: onOpenNews },
    { id: 'skills', label: t('common:tabs.skills'), Icon: Blocks, action: onOpenSkills },
    { id: 'autoresearch', label: t('common:tabs.autoResearch'), Icon: FlaskConical, action: onOpenAutoResearch },
    { id: 'compute', label: t('common:tabs.compute'), Icon: Monitor, action: onOpenCompute },
    { id: 'trash', label: t('common:tabs.trash'), Icon: Trash2, action: onOpenTrash },
  ];
  // Mark the folded row while one of its pages is open, so the current
  // location is still visible.
  const hasActivePage = tools.some((tool) => tool.id === activeTab);

  return (
    <footer className="shrink-0 border-t border-border px-3 py-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      {updateAvailable && (
        <button className={rowClass} onClick={onShowVersionModal}>
          <ArrowUpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{releaseInfo?.title || `v${latestVersion}`} · {t('version.updateAvailable')}</span>
        </button>
      )}

      {expanded && (
        <div id={panelId} className="pb-1">
          <nav aria-label={t('common:workbench.tools')}>
            {tools.map(({ id, label, Icon, action }) => (
              <button
                key={id}
                onClick={action}
                aria-current={activeTab === id ? 'page' : undefined}
                className={cn(rowClass, activeTab === id ? 'bg-muted text-foreground' : 'text-muted-foreground')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <button className={cn(rowClass, 'text-muted-foreground')} onClick={onShowSettings}>
            <Settings className="h-4 w-4" />
            <span>{t('actions.settings')}</span>
          </button>
          {onLogout && (
            <button className={cn(rowClass, 'text-muted-foreground')} onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              {t('actions.logout')}
            </button>
          )}
        </div>
      )}

      <button
        className={cn(rowClass, 'text-muted-foreground', !expanded && hasActivePage && 'bg-muted text-foreground')}
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span className="truncate">{t('common:workbench.sidebar.toolsAndSettings')}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
          v{currentVersion}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
    </footer>
  );
}
