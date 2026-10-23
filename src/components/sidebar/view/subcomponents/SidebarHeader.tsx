import { LayoutDashboard, PanelLeftClose, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';
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
  t: TFunction;
};

export default function SidebarHeader({
  searchFilter, onSearchFilterChange, onClearSearchFilter,
  onRefresh, isRefreshing, activeTab, onOpenDashboard, onCreateProject,
  onCollapseSidebar, t,
}: SidebarHeaderProps) {
  return (
    <div className="shrink-0 p-3">
      <div className="flex min-h-9 items-center gap-2 electron-drag" style={{ paddingLeft: isMacElectron ? 68 : undefined }}>
        <img src="/icons/file.svg" alt="" className="h-7 w-7 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('app.title')}</span>
        <Button className="electron-no-drag h-8 w-8 p-0" variant="ghost" onClick={onCollapseSidebar} aria-label={t('common:workbench.collapseSidebar')}><PanelLeftClose /></Button>
      </div>
      <Button className="mt-4 w-full justify-start" onClick={onCreateProject}><Plus />{t('common:workbench.newProject')}</Button>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label={t('projects.searchPlaceholder')} placeholder={t('projects.searchPlaceholder')} value={searchFilter} onChange={event => onSearchFilterChange(event.target.value)} className="pl-9 pr-8" />
        {searchFilter && <button className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded hover:bg-muted" onClick={onClearSearchFilter} aria-label={t('common:buttons.clear')}><X className="h-4 w-4" /></button>}
      </div>
      <div className="mt-3 flex items-center gap-1">
        <Button className="flex-1 justify-start" variant={activeTab === 'dashboard' ? 'secondary' : 'ghost'} onClick={onOpenDashboard} aria-current={activeTab === 'dashboard' ? 'page' : undefined}><LayoutDashboard />{t('common:workbench.projects')}</Button>
        <Button variant="ghost" size="icon" disabled={isRefreshing} onClick={onRefresh} aria-label={t('tooltips.refresh')}><RefreshCw className={isRefreshing ? 'animate-spin' : ''} /></Button>
      </div>
    </div>
  );
}
