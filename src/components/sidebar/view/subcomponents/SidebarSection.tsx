import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../../lib/utils';

const storageKey = (id: string) => `dr-claw.sidebarSection.${id}.collapsed`;

const readCollapsed = (id: string) => {
  try {
    return localStorage.getItem(storageKey(id)) === '1';
  } catch {
    return false;
  }
};

/**
 * Collapsible group of sidebar rows with a small heading, e.g. "Pinned".
 * Without a heading it is a plain wrapper, so its rows stay mounted when the
 * heading comes and goes.
 */
export default function SidebarSection({ id, title, showHeader = true, children }: {
  id: string;
  title: string;
  showHeader?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const contentId = useId();
  const isCollapsed = showHeader && collapsed;

  const toggle = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(storageKey(id), next ? '1' : '0');
      } catch {
        // Collapsing still works for this session.
      }
      return next;
    });
  };

  return (
    <section data-sidebar-section={id} aria-label={showHeader ? title : undefined} className="flex flex-col gap-px">
      {showHeader && (
        <button
          type="button"
          className="flex min-h-9 items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-7"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : contentId}
        >
          <span>{title}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', collapsed && '-rotate-90')} />
        </button>
      )}
      {!isCollapsed && (
        <div id={contentId} className="flex flex-col gap-px">
          {children}
        </div>
      )}
    </section>
  );
}
