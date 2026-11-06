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

      {/* Phones scroll the whole drawer; growing keeps the footer at the
          bottom when the project list is short. */}
      <ScrollArea className={isMobile ? 'shrink-0 grow' : 'min-h-0 flex-1 px-1.5 py-2 overflow-y-auto overscroll-contain'}>
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>

      <SidebarFooter
        activeTab={activeTab}
        onOpenNews={onOpenNews}
        onOpenSkills={onOpenSkills}
        onOpenAutoResearch={onOpenAutoResearch}
        onOpenCompute={onOpenCompute}
        onOpenTrash={onOpenTrash}
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
