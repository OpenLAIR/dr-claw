import type { AppTab, Project } from '../../../../types/app';
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarResearchTools from './SidebarResearchTools';

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
  onOpenNews: () => void;
  onOpenCommunityTools: () => void;
  onStartResearchRun: (toolId: string) => void;
  onSelectResearchRun: (toolId: string, runPath: string) => void;
  onDeleteResearchRun?: (toolId: string, runPath: string) => Promise<void>;
  selectedResearchRun: string | null;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onLogout: () => void;
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
  onOpenNews,
  onOpenCommunityTools,
  onStartResearchRun,
  onSelectResearchRun,
  onDeleteResearchRun,
  selectedResearchRun,
  onCreateProject,
  onCollapseSidebar,
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
    <div
      className="h-full flex flex-col bg-background/80 backdrop-blur-sm md:select-none w-full"
      style={{}}
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
        onOpenNews={onOpenNews}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <SidebarResearchTools
        activeTab={activeTab}
        selectedRunPath={selectedResearchRun}
        onSelectRun={onSelectResearchRun}
        onDeleteRun={onDeleteResearchRun}
        onOpenConfig={onOpenCommunityTools}
        onStartRun={onStartResearchRun}
      />

      <div className="hidden md:block nav-divider mx-3" />

      <ScrollArea className="flex-1 md:px-1.5 md:py-2 overflow-y-auto overscroll-contain">
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>

      <SidebarFooter
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
