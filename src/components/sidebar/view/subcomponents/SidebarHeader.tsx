import { PanelLeftClose, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Ref } from 'react';
import type { AppTab } from '../../../../types/app';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { isMacElectron } from '../../../../hooks/useDesktop';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeTab: AppTab;
  onOpenDashboard: () => void;
  onOpenTrash: () => void;
  onOpenSkills: () => void;
  onOpenAutoResearch: () => void;
  onOpenNews: () => void;
  onOpenCompute: () => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  toggleButtonRef: Ref<HTMLButtonElement>;
  t: TFunction;
};

export default function SidebarHeader({
  searchFilter, onSearchFilterChange, onClearSearchFilter,
  onRefresh, isRefreshing, activeTab, onOpenDashboard, onCreateProject,
  onCollapseSidebar, toggleButtonRef, isMobile, t,
}: SidebarHeaderProps) {
  return (
    <div data-sidebar-header className={`shrink-0 p-3 ${isMobile ? 'sticky top-0 z-10 bg-background' : ''}`}>
      {isMacElectron && <div className="h-6 electron-drag" aria-hidden="true" />}
      <div className="flex min-h-9 items-center gap-2 electron-drag">
        {/* The brand doubles as the way home to the projects overview. */}
        <button
          type="button"
          data-sidebar-brand
          className="electron-no-drag flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpenDashboard}
          aria-current={activeTab === 'dashboard' ? 'page' : undefined}
          title={t('common:workbench.sidebar.openProjectsOverview')}
        >
          <img src="/icons/file.svg" alt="" className="h-7 w-7 shrink-0" />
          <span className="min-w-0 truncate text-sm font-semibold">{t('app.title')}</span>
          <span className="sr-only">{t('common:workbench.sidebar.openProjectsOverview')}</span>
        </button>
        <Button
          ref={toggleButtonRef}
          className={`electron-no-drag shrink-0 p-0 ${isMobile ? 'h-11 w-11' : 'h-8 w-8'}`}
          variant="ghost"
          onClick={onCollapseSidebar}
          aria-expanded={isMobile ? undefined : true}
          aria-label={t(isMobile ? 'common:workbench.closeMenu' : 'common:workbench.collapseSidebar')}
        >{isMobile ? <X /> : <PanelLeftClose />}</Button>
      </div>
      <Button className="mt-4 w-full justify-start" onClick={onCreateProject}><Plus />{t('common:workbench.newProject')}</Button>
      <div className="mt-3 flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label={t('projects.searchPlaceholder')} placeholder={t('projects.searchPlaceholder')} value={searchFilter} onChange={event => onSearchFilterChange(event.target.value)} className="pl-9 pr-8" />
          {searchFilter && <button className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded hover:bg-muted" onClick={onClearSearchFilter} aria-label={t('common:buttons.clear')}><X className="h-4 w-4" /></button>}
        </div>
        <Button className="shrink-0" variant="ghost" size="icon" disabled={isRefreshing} onClick={onRefresh} title={t('tooltips.refresh')} aria-label={t('tooltips.refresh')}><RefreshCw className={isRefreshing ? 'animate-spin' : ''} /></Button>
      </div>
    </div>
  );
}
