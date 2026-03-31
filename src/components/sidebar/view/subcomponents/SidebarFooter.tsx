import { Settings, ArrowUpCircle, LogOut } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

type SidebarFooterProps = {
  currentVersion: string;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onLogout: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  currentVersion,
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  onLogout,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden md:block px-2 py-1.5">
            <button
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-blue-50/80 dark:hover:bg-blue-900/15 transition-colors group"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-300 truncate block">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-[10px] text-blue-500/70 dark:text-blue-400/60">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="md:hidden px-3 py-2">
            <button
              className="w-full h-11 bg-blue-50/80 dark:bg-blue-900/15 border border-blue-200/60 dark:border-blue-700/40 rounded-xl flex items-center gap-3 px-3.5 active:scale-[0.98] transition-all"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="w-4.5 h-4.5 text-blue-500 dark:text-blue-400" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="text-sm font-medium text-blue-600 dark:text-blue-300 truncate block">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-blue-500/70 dark:text-blue-400/60">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Settings */}
      <div className="px-2 pb-1.5">
        <div className="hidden md:flex items-center justify-between px-2.5 py-2 rounded-lg bg-muted/35 text-xs">
          <span className="text-muted-foreground">{t('common:common.version')}</span>
          <span className="font-mono font-medium text-foreground">v{currentVersion}</span>
        </div>
        <div className="md:hidden px-3.5 py-2 rounded-xl bg-muted/35 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('common:common.version')}</span>
          <span className="text-sm font-mono font-medium text-foreground">v{currentVersion}</span>
        </div>
      </div>

      <div className="nav-divider" />

      {/* Desktop settings */}
      <div className="hidden md:block px-2 py-1.5 space-y-1.5">
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          onClick={onShowSettings}
        >
          <Settings className="w-4 h-4" />
          <span className="text-[14px] font-medium">{t('actions.settings')}</span>
        </button>
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          onClick={onLogout}
        >
          <LogOut className="w-4 h-4" />
          <span className="text-[14px] font-medium">{t('actions.logout')}</span>
        </button>
      </div>

      {/* Mobile settings */}
      <div className="md:hidden p-3 pb-20 space-y-2">
        <button
          className="w-full h-12 bg-muted/40 hover:bg-muted/60 rounded-xl flex items-center gap-3.5 px-4 active:scale-[0.98] transition-all"
          onClick={onShowSettings}
        >
          <div className="w-8 h-8 rounded-xl bg-background/80 flex items-center justify-center">
            <Settings className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.settings')}</span>
        </button>
        <button
          className="w-full h-12 bg-muted/40 hover:bg-muted/60 rounded-xl flex items-center gap-3.5 px-4 active:scale-[0.98] transition-all"
          onClick={onLogout}
        >
          <div className="w-8 h-8 rounded-xl bg-background/80 flex items-center justify-center">
            <LogOut className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.logout')}</span>
        </button>
      </div>
    </div>
  );
}
