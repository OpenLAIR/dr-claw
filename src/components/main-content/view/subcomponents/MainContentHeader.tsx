import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';
import type { MainContentHeaderProps } from '../../types/types';
import { isMacElectron } from '../../../../hooks/useDesktop';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  const { preferences } = useUiPreferences();
  // Match the expanded sidebar's 80px traffic-light safe zone. The collapsed
  // rail covers 48px of it; on mobile layouts the content starts at x=0.
  const trafficLightPadding = isMacElectron
    ? (isMobile ? 80 : !preferences.sidebarVisible ? 32 : undefined)
    : undefined;

  return (
    /*
     * electron-drag: makes the header bar a window drag handle on macOS.
     * Interactive children (title area with potential buttons, tab switcher)
     * use electron-no-drag to restore normal pointer events inside the drag
     * region. The trailing empty flex-1 div stays draggable as dead space.
     */
    <div
      className="bg-background border-b border-border/60 px-3 sm:px-4 pwa-header-safe flex-shrink-0 electron-drag"
      style={{ paddingLeft: trafficLightPadding }}
    >
      <div className="flex items-center gap-3 py-1.5 sm:py-2">
        <div className="flex items-center gap-2 min-w-0 flex-1 electron-no-drag">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>

        <div className="hidden sm:flex justify-center flex-1 electron-no-drag">
          {selectedProject && activeTab !== 'dashboard' && activeTab !== 'trash' && (
            <MainContentTabSwitcher
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              shouldShowTasksTab={shouldShowTasksTab}
            />
          )}
        </div>

        {/* Empty right spacer — stays as drag region */}
        <div className="flex-1 hidden sm:block" />
      </div>
    </div>
  );
}
