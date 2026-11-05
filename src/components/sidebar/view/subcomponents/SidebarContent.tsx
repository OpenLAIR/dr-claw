import { Blocks, FlaskConical, Monitor, Newspaper, Trash2 } from 'lucide-react';
import type { AppTab, Project } from '../../../../types/app';
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import type { Ref } from 'react';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
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
  currentVersion: string;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onLogout?: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  activeTab,
  onOpenDashboard,
  onOpenTrash,
  onOpenSkills,
  onOpenAutoResearch,
  onOpenNews,
  onOpenCompute,
  onCreateProject,
  onCollapseSidebar,
  toggleButtonRef,
  currentVersion,
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  onLogout,
  projectListProps,
  t,
}: SidebarContentProps) {
  return (
    <div data-sidebar-content
      className={`h-full flex flex-col bg-background md:select-none w-full ${isMobile ? 'overflow-y-auto overscroll-contain' : ''}`}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        activeTab={activeTab}
        onOpenDashboard={onOpenDashboard}
        onOpenTrash={onOpenTrash}
        onOpenSkills={onOpenSkills}
        onOpenAutoResearch={onOpenAutoResearch}
        onOpenNews={onOpenNews}
        onOpenCompute={onOpenCompute}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        toggleButtonRef={toggleButtonRef}
        t={t}
      />

      <ScrollArea className={isMobile ? 'shrink-0' : 'min-h-0 flex-1 px-1.5 py-2 overflow-y-auto overscroll-contain'}>
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>

      <nav aria-label={t('common:workbench.tools')} className="shrink-0 border-t border-border px-3 py-2">
        <p className="px-2 py-2 text-xs text-muted-foreground">{t('common:workbench.tools')}</p>
        {[
          { id: 'news', label: 'tabs.news', Icon: Newspaper, action: onOpenNews },
          { id: 'skills', label: 'tabs.skills', Icon: Blocks, action: onOpenSkills },
          { id: 'autoresearch', label: 'tabs.autoResearch', Icon: FlaskConical, action: onOpenAutoResearch },
          { id: 'compute', label: 'tabs.compute', Icon: Monitor, action: onOpenCompute },
        ].map(({ id, label, Icon, action }) => <button key={id} onClick={action} aria-current={activeTab === id ? 'page' : undefined} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted ${activeTab === id ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><Icon className="h-4 w-4" />{t(`common:${label}`)}</button>)}
      </nav>
      <button onClick={onOpenTrash} aria-current={activeTab === 'trash' ? 'page' : undefined} className="mx-3 flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" />{t('common:tabs.trash')}</button>
      <SidebarFooter
        currentVersion={currentVersion}
        updateAvailable={updateAvailable}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        onLogout={onLogout}
        t={t}
      />
    </div>
  );
}
