import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { stripInternalContextPrefix } from '../../../../utils/sessionFormatting';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string) {
  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'dashboard') {
    return t('projectDashboard.title');
  }

  if (activeTab === 'trash') {
    return t('projectDashboard.trashTitle');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'survey') {
    return t('tabs.survey');
  }

  if (activeTab === 'researchlab') {
    return t('tabs.researchLab');
  }

  if (activeTab === 'skills') {
    return t('tabs.skills');
  }

  if (activeTab === 'news') {
    return t('tabs.news');
  }

  if (activeTab === 'community-tools') {
    return t('tabs.communityTools');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  const name = session.__provider === 'cursor' 
    ? (session.name as string) || 'Untitled Session'
    : (session.summary as string) || 'New Session';
    
  return stripInternalContextPrefix(name) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const isDashboard = activeTab === 'dashboard';
  const isTrash = activeTab === 'trash';
  const isGlobalSkills = activeTab === 'skills' && !selectedProject;
  const isGlobalNews = activeTab === 'news' && !selectedProject;

  return (
    <div className="min-w-0 flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
      {showSessionIcon && (
        <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="w-4 h-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {isDashboard ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">
              {t('projectDashboard.title')}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
              {t('projectDashboard.subtitle')}
            </div>
          </div>
        ) : isTrash ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">
              {t('projectDashboard.trashTitle')}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
              {t('projectDashboard.trashSubtitle')}
            </div>
          </div>
        ) : isGlobalSkills ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">
              {t('projectDashboard.skillsTitle')}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
              {t('projectDashboard.skillsDescription')}
            </div>
          </div>
        ) : isGlobalNews ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">
              {t('newsDashboard.title', 'Paper News')}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
              {t('newsDashboard.subtitle', 'Discover the latest research from arXiv, automatically scored by relevance, recency, popularity, and quality.')}
            </div>
          </div>
        ) : activeTab === 'chat' && selectedSession && selectedProject ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
              {getSessionTitle(selectedSession)}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProject.displayName}</div>
          </div>
        ) : showChatNewSession && selectedProject ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">{t('mainContent.newSession')}</h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProject.displayName}</div>
          </div>
        ) : selectedProject ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight">
              {getTabTitle(activeTab, shouldShowTasksTab, t)}
            </h2>
            <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProject.displayName}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
