import { Settings, ArrowUpCircle, LogOut } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

type SidebarFooterProps = {
  currentVersion: string; updateAvailable: boolean; releaseInfo: ReleaseInfo | null;
  latestVersion: string | null; onShowVersionModal: () => void;
  onShowSettings: () => void; onLogout?: () => void; t: TFunction;
};

export default function SidebarFooter({ currentVersion, updateAvailable, releaseInfo, latestVersion,
  onShowVersionModal, onShowSettings, onLogout, t }: SidebarFooterProps) {
  return (
    <footer className="shrink-0 border-t border-border px-3 py-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      {updateAvailable && <button className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted" onClick={onShowVersionModal}><ArrowUpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" /><span className="truncate">{releaseInfo?.title || `v${latestVersion}`} · {t('version.updateAvailable')}</span></button>}
      <button className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted" onClick={onShowSettings}><Settings className="h-4 w-4" /><span>{t('actions.settings')}</span><span className="ml-auto text-xs tabular-nums">v{currentVersion}</span></button>
      {onLogout && <button className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted" onClick={onLogout}><LogOut className="h-4 w-4" />{t('actions.logout')}</button>}
    </footer>
  );
}
