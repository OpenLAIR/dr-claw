import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import StandaloneShell from '../../../StandaloneShell';
import type { Project, ProjectSession } from '../../../../types/app';

type Props = { project: Project; session?: ProjectSession | null };
type ShellInstance = { id: string; title: string };
type ShellTab = ShellInstance & { kind: 'session' | 'plain' };
const AnyStandaloneShell = StandaloneShell as any;
const createId = () => `shell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const control = 'h-11 md:h-8 shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:bg-accent';

// A new project gets its own state before persistence runs; never write the
// previous project's tabs into the next project's storage key.
export default function ShellWorkspace(props: Props) {
  return <Workspace key={props.project.fullPath || props.project.path || props.project.name} {...props} />;
}

function Workspace({ project, session = null }: Props) {
  const { t } = useTranslation('chat');
  const storageKey = `shell-workspace-state:${project.fullPath || project.path || project.name}`;
  const makeShell = (index: number): ShellInstance => ({ id: createId(), title: t('shell.workspace.tabTitle', { index }) });
  const [initial] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
      const ids = new Set<string>();
      const shells: ShellInstance[] = (Array.isArray(stored?.shells) ? stored.shells : []).filter((item: any) => {
        if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || ids.has(item.id)) return false;
        ids.add(item.id); return true;
      });
      if (shells.length) return { shells, active: shells.some(item => item.id === stored.activeShellId) ? stored.activeShellId : shells[0].id };
    } catch { /* Storage may be unavailable; terminals still work in memory. */ }
    const first = makeShell(1);
    return { shells: [first], active: first.id };
  });
  const sessionId = session ? `session-shell:${session.id}` : null;
  const [shells, setShells] = useState<ShellInstance[]>(initial.shells);
  const [activeId, setActiveId] = useState<string>(sessionId || initial.active);
  const [sessionVisible, setSessionVisible] = useState(Boolean(sessionId));
  const [visited, setVisited] = useState(() => new Set<string>([sessionId || initial.active]));
  const nextNumber = useRef(Math.max(shells.length, ...shells.map(item => Number(item.title.match(/\d+$/)?.[0]) || 0)) + 1);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef(false);
  const previousSession = useRef(sessionId);
  useEffect(() => {
    if (previousSession.current === sessionId) return;
    previousSession.current = sessionId;
    setSessionVisible(Boolean(sessionId));
    setActiveId(sessionId || shells[0].id);
  }, [sessionId, shells]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ shells, activeShellId: activeId.startsWith('session-shell:') ? shells[0].id : activeId })); } catch { /* Keep usable in memory. */ }
  }, [storageKey, shells, activeId]);
  useEffect(() => { setVisited(prev => prev.has(activeId) ? prev : new Set([...prev, activeId])); }, [activeId]);
  useLayoutEffect(() => {
    if (focusNext.current) { buttons.current.get(activeId)?.focus(); focusNext.current = false; }
  }, [activeId, shells, sessionVisible]);

  const title = session?.summary || session?.title || session?.name || t('shell.workspace.currentSession');
  const tabs: ShellTab[] = [
    ...(session && sessionId && sessionVisible ? [{ id: sessionId, title, kind: 'session' as const }] : []),
    ...shells.map(shell => ({ ...shell, kind: 'plain' as const })),
  ];
  const activate = (id: string) => { focusNext.current = true; setActiveId(id); };
  const add = () => {
    const shell = makeShell(nextNumber.current++);
    setShells(prev => [...prev, shell]); activate(shell.id);
  };
  const close = (id: string) => {
    const index = tabs.findIndex(tab => tab.id === id);
    let remaining = tabs.filter(tab => tab.id !== id);
    if (id === sessionId) setSessionVisible(false);
    else {
      const next = shells.filter(shell => shell.id !== id);
      if (!next.length) {
        const replacement = makeShell(nextNumber.current++);
        next.push(replacement); remaining = [...remaining, { ...replacement, kind: 'plain' }];
      }
      setShells(next);
    }
    focusNext.current = true;
    const fallback = id === activeId ? remaining[Math.max(0, index - 1)] || remaining[0] : tabs.find(tab => tab.id === activeId);
    if (fallback) { setActiveId(fallback.id); buttons.current.get(fallback.id)?.focus(); }
  };

  return <div className="flex h-full min-w-0 flex-col bg-background text-foreground" data-shell-workspace>
    {session && sessionVisible && <details className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{t('shell.historyEdit.bannerTitle')}</summary>
      <p className="mt-2 leading-relaxed">{t('shell.historyEdit.bannerDescription')}</p>
    </details>}
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
      <div role="tablist" aria-label={t('shell.workspace.tabs')} className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-thin">
        {tabs.map((tab, index) => <div key={tab.id} className={`flex shrink-0 items-center rounded-md ${tab.id === activeId ? 'bg-accent' : 'text-muted-foreground'}`}>
          <button type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
            ref={node => { if (node) buttons.current.set(tab.id, node); else buttons.current.delete(tab.id); }}
            className={`${control} flex min-w-0 items-center gap-2 px-2 text-sm`} title={tab.title} onClick={() => activate(tab.id)}
            onKeyDown={event => {
              let next: number | undefined;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = tabs.length - 1;
              if (next !== undefined) { event.preventDefault(); activate(tabs[next].id); buttons.current.get(tabs[next].id)?.focus(); }
            }}><Terminal className="h-4 w-4 shrink-0" /><span className="max-w-[160px] truncate">{tab.title}</span></button>
          <button type="button" className={`${control} flex w-11 md:w-8 items-center justify-center text-muted-foreground`} onClick={() => close(tab.id)} aria-label={t('shell.workspace.closeShell', { title: tab.title })} title={t('shell.workspace.closeShell', { title: tab.title })}><X className="h-4 w-4" /></button>
        </div>)}
      </div>
      <button type="button" onClick={add} className={`${control} flex w-11 md:w-8 items-center justify-center`} aria-label={t('shell.workspace.newShell')} title={t('shell.workspace.newShell')}><Plus className="h-4 w-4" /></button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tabs.filter(tab => tab.id === activeId || visited.has(tab.id)).map(tab => <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} aria-hidden={tab.id !== activeId || undefined}
        ref={node => { if (node) node.inert = tab.id !== activeId; }} className={`absolute inset-0 ${tab.id === activeId ? 'visible' : 'invisible'}`}>
        <AnyStandaloneShell project={project} session={tab.kind === 'session' ? session : null} isPlainShell={tab.kind === 'plain'} shellInstanceId={tab.kind === 'plain' ? tab.id : null} showHeader={false} />
      </div>)}
    </div>
  </div>;
}
