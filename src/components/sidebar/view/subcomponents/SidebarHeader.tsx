import { Blocks, FolderPlus, LayoutDashboard, Newspaper, PanelLeftClose, Plus, RefreshCw, Search, Trash2, Wrench, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { IS_PLATFORM } from '../../../../constants/config';

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
  onOpenNews: () => void;
  onOpenCommunityTools: () => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  activeTab,
  onOpenDashboard,
  onOpenTrash,
  onOpenSkills,
  onOpenNews,
  onOpenCommunityTools,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const LogoBlock = () => (
    <div className="flex items-center gap-2.5 min-w-0">
      <img src="/icons/file.svg" alt="Dr. Claw" className="w-7 h-7 rounded-lg shadow-sm flex-shrink-0" />
      <h1 className="text-[15px] font-bold text-foreground tracking-tight truncate">{t('app.title')}</h1>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden md:block px-3 pt-3 pb-2"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://github.com/OpenLAIR/dr-claw"
              className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search bar */}
        {!isLoading && (
          <div className="mt-2.5 space-y-2">
            {projectsCount > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                <Input
                  type="text"
                  placeholder={t('projects.searchPlaceholder')}
                  value={searchFilter}
                  onChange={(event) => onSearchFilterChange(event.target.value)}
                  className="nav-search-input pl-9 pr-8 h-9 text-xs rounded-xl border-0 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={onClearSearchFilter}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-accent rounded-md"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            <Button
              type="button"
              variant={activeTab === 'dashboard' ? 'secondary' : 'outline'}
              size="sm"
              className="h-9 w-full justify-start rounded-xl"
              onClick={onOpenDashboard}
            >
              <LayoutDashboard className="h-4 w-4" />
              {t('common:projectDashboard.title')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'news' ? 'secondary' : 'outline'}
              size="sm"
              className="h-9 w-full justify-start rounded-xl"
              onClick={onOpenNews}
            >
              <Newspaper className="h-4 w-4" />
              {t('common:tabs.news')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'skills' ? 'secondary' : 'outline'}
              size="sm"
              className="h-9 w-full justify-start rounded-xl"
              onClick={onOpenSkills}
            >
              <Blocks className="h-4 w-4" />
              {t('common:projectDashboard.skillsTitle')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'community-tools' ? 'secondary' : 'outline'}
              size="sm"
              className="h-9 w-full justify-start rounded-xl"
              onClick={onOpenCommunityTools}
            >
              <Wrench className="h-4 w-4" />
              {t('common:tabs.communityTools')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'trash' ? 'secondary' : 'outline'}
              size="sm"
              className="h-9 w-full justify-start rounded-xl"
              onClick={onOpenTrash}
            >
              <Trash2 className="h-4 w-4" />
              {t('common:tabs.trash')}
            </Button>
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="hidden md:block nav-divider" />

      {/* Mobile header */}
      <div
        className="md:hidden p-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://github.com/OpenLAIR/dr-claw"
              className="flex items-center gap-2.5 active:opacity-70 transition-opacity min-w-0"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex gap-1.5 flex-shrink-0">
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center active:scale-95 transition-all"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-primary/90 text-primary-foreground flex items-center justify-center active:scale-95 transition-all"
              onClick={onCreateProject}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {!isLoading && (
          <div className="mt-2.5 space-y-2">
            {projectsCount > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50 pointer-events-none" />
                <Input
                  type="text"
                  placeholder={t('projects.searchPlaceholder')}
                  value={searchFilter}
                  onChange={(event) => onSearchFilterChange(event.target.value)}
                  className="nav-search-input pl-10 pr-9 h-10 text-sm rounded-xl border-0 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={onClearSearchFilter}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded-md"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            <Button
              type="button"
              variant={activeTab === 'dashboard' ? 'secondary' : 'outline'}
              className="h-10 w-full justify-start rounded-xl"
              onClick={onOpenDashboard}
            >
              <LayoutDashboard className="h-4 w-4" />
              {t('common:projectDashboard.title')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'news' ? 'secondary' : 'outline'}
              className="h-10 w-full justify-start rounded-xl"
              onClick={onOpenNews}
            >
              <Newspaper className="h-4 w-4" />
              {t('common:tabs.news')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'skills' ? 'secondary' : 'outline'}
              className="h-10 w-full justify-start rounded-xl"
              onClick={onOpenSkills}
            >
              <Blocks className="h-4 w-4" />
              {t('common:projectDashboard.skillsTitle')}
            </Button>

            <Button
              type="button"
              variant={activeTab === 'community-tools' ? 'secondary' : 'outline'}
              className="h-10 w-full justify-start rounded-xl"
              onClick={onOpenCommunityTools}
            >
              <Wrench className="h-4 w-4" />
              {t('common:tabs.communityTools')}
            </Button>
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="md:hidden nav-divider" />
    </div>
  );
}
