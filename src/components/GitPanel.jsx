import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import WorkbenchDialog from './ui/WorkbenchDialog';
import DiffViewer from './DiffViewer.jsx';
import { useGitWorkspace } from './git/useGitWorkspace';

const touch = 'min-h-11 md:min-h-8';
function Failure({ message, retry, busy = false }) {
  const { t } = useTranslation('common');
  if (!message) return null;
  return <div role="alert" className="my-2 rounded-md border border-destructive/30 px-3 py-2 text-sm">
    <p>{t('git.failed')}</p><details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{t('git.details')}</summary><p className="mt-1 whitespace-pre-wrap break-words">{message}</p></details>
    {retry && <Button type="button" variant="outline" size="sm" className={`mt-2 ${touch}`} disabled={busy} onClick={retry}>{t('git.retry')}</Button>}
  </div>;
}
function Diff({ workspace, kind, value, isMobile, wrap }) {
  const { t } = useTranslation('common');
  const key = `${kind}:${value}`;
  const diff = workspace.diffs[key];
  const error = workspace.errors[key];
  const loading = workspace.loading[key];
  useEffect(() => {
    if (diff === undefined && !error && !loading) void workspace.loadDiff(kind, value);
  }, [diff, error, loading, kind, value, workspace.loadDiff]);
  return <div className="min-w-0 border-t border-border py-2">
    {error ? <Failure message={error} retry={() => workspace.loadDiff(kind, value)} busy={loading} /> : diff === undefined ? <p role="status" className="px-3 text-sm text-muted-foreground">{t('git.loading')}</p> : diff ? <DiffViewer diff={diff} fileName={value} isMobile={isMobile} wrapText={wrap} /> : <p className="px-3 text-sm text-muted-foreground">{t('git.noDiff')}</p>}
  </div>;
}

export default function GitPanel(props) {
  return <GitWorkspace key={props.selectedProject?.name || 'empty'} {...props} />;
}
function GitWorkspace({ selectedProject, isMobile, onFileOpen }) {
  const { t } = useTranslation('common');
  const git = useGitWorkspace(selectedProject?.name);
  const [view, setView] = useState('changes');
  const [message, setMessage] = useState('');
  const draftRevision = useRef(0);
  const [branch, setBranch] = useState('');
  const [newBranch, setNewBranch] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [wrap, setWrap] = useState(true);
  const [generated, setGenerated] = useState('');
  const files = [...new Map(['modified', 'added', 'deleted', 'untracked'].flatMap(kind => (git.status?.[kind] || []).map(file => [file, { file, kind }]))).values()];
  const currentBranch = git.status?.branch || '';
  const busy = Boolean(git.busy);
  const changeMessage = value => { draftRevision.current++; setMessage(value); };
  const confirm = (action, payload = {}) => { git.clearActionError(); setConfirmation({ action, payload }); };
  const confirmCommit = () => {
    if (!message.trim() || !git.selected.size || busy) return;
    confirm('commit', { message: message.trim(), files: [...git.selected] });
  };
  const execute = async () => {
    const result = await git.mutate(confirmation.action, confirmation.payload);
    if (!result) return;
    if (confirmation.action === 'commit') { changeMessage(''); git.setSelected(new Set()); }
    setConfirmation(null);
  };
  const generate = async () => {
    const revision = draftRevision.current;
    setGenerated('');
    const result = await git.mutate('generate-commit-message', { files: [...git.selected], provider: localStorage.getItem('selected-provider') || 'claude' });
    if (result?.message) {
      if (revision === draftRevision.current) changeMessage(result.message);
      else setGenerated(result.message);
    }
  };
  const toggle = key => setExpanded(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  if (!selectedProject) return <p className="p-4 text-sm text-muted-foreground">{t('git.selectProject')}</p>;
  return <div className="flex h-full min-w-0 flex-col bg-background text-foreground" data-git-workspace>
    <header className="shrink-0 border-b border-border px-[18px] py-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        {currentBranch ? <select aria-label={t('git.branch')} title={currentBranch} value={currentBranch} disabled={busy || git.loading.branches}
          onChange={event => { void git.mutate('checkout', { branch: event.target.value }); }}
          className={`min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${touch}`}>
          {[...new Set([currentBranch, ...git.branches])].map(value => <option key={value} value={value}>{value}</option>)}
        </select> : <span className="min-w-0 flex-1 text-sm">{t('git.title')}</span>}
        <Button type="button" variant="ghost" size="icon" className={`${touch} min-w-11 md:min-w-8`} disabled={!git.status || busy} onClick={() => { git.clearActionError(); setNewBranch(true); }} aria-label={t('git.newBranch')} title={t('git.newBranch')}><Plus /></Button>
        <Button type="button" variant="ghost" size="icon" className={`${touch} min-w-11 md:min-w-8`} disabled={busy || git.loading.status} onClick={git.refresh} aria-label={t('git.refresh')} title={t('git.refresh')}><RefreshCw /></Button>
      </div>
      {git.remote?.hasRemote && git.status?.hasCommits !== false && <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 break-all text-xs text-muted-foreground">{git.remote.remoteName || 'origin'}</span>
        <Button type="button" variant="outline" size="sm" className={touch} disabled={busy} onClick={() => git.mutate('fetch')}>{t('git.actions.fetch')}</Button>
        {git.remote.hasUpstream ? <>
          <Button type="button" variant="outline" size="sm" className={touch} disabled={busy || !git.remote.behind} onClick={() => confirm('pull')}>{t('git.actions.pull')} {git.remote.behind || 0}</Button>
          <Button type="button" variant="outline" size="sm" className={touch} disabled={busy || !git.remote.ahead} onClick={() => confirm('push')}>{t('git.actions.push')} {git.remote.ahead || 0}</Button>
        </> : <Button type="button" variant="outline" size="sm" className={touch} disabled={busy} onClick={() => confirm('publish', { branch: currentBranch })}>{t('git.actions.publish')}</Button>}
      </div>}
    </header>
    {git.status && <div role="tablist" aria-label={t('git.views')} className="flex shrink-0 border-b border-border">
      {['changes', 'history'].map((tab, index) => <button key={tab} type="button" role="tab" id={`git-tab-${tab}`} aria-controls="git-content" aria-selected={view === tab} tabIndex={view === tab ? 0 : -1}
        className={`min-h-11 flex-1 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${view === tab ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:bg-accent'}`}
        onClick={() => setView(tab)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 'changes' : event.key === 'End' ? 'history' : index ? 'changes' : 'history';
            setView(next); document.getElementById(`git-tab-${next}`)?.focus();
          }
        }}>{t(`git.${tab}`)}{tab === 'changes' && files.length > 0 ? ` (${files.length})` : ''}</button>)}
    </div>}
    <div id="git-content" role={git.status ? 'tabpanel' : undefined} aria-labelledby={git.status ? `git-tab-${view}` : undefined} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[18px] py-3">
      {!confirmation && !newBranch && <Failure message={git.errors.action} />}
      {git.notice && <p role="status" className="mb-2 text-xs text-muted-foreground">{t('git.completed', { action: t(`git.actions.${git.notice}`) })}</p>}
      {['status', 'branches', 'remote'].map(key => <Failure key={key} message={git.errors[key]} retry={() => key === 'status' ? git.refresh() : git.load(key)} busy={git.loading[key]} />)}
      {!git.status && git.loading.status && <p role="status" className="py-6 text-sm text-muted-foreground">{t('git.loading')}</p>}
      {git.missingRepo && <div className="space-y-3 py-6"><h3 className="text-sm font-medium">{t('git.noRepo')}</h3><p className="text-sm text-muted-foreground">{t('git.enableDescription')}</p><Button type="button" className={touch} disabled={busy} onClick={() => git.mutate('init')}>{t('git.actions.init')}</Button></div>}
      {git.status?.hasCommits === false && <div className="mb-3 border-b border-border pb-3 text-sm"><p className="mb-2 text-muted-foreground">{t('git.initialDescription')}</p><Button type="button" variant="outline" className={`${touch} max-w-full whitespace-normal`} disabled={busy} onClick={() => git.mutate('initial-commit')}>{t('git.actions.initial-commit')}</Button></div>}
      {git.status && view === 'changes' && <>
        {files.length > 0 ? <>
          <details open={!isMobile} className="mb-3 rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-3 text-sm font-medium focus-visible:ring-1 focus-visible:ring-ring">{t('git.commitSelected', { count: git.selected.size })}</summary>
            <div className="space-y-2 border-t border-border p-3">
              <label className="block text-sm" htmlFor="git-message">{t('git.message')}</label>
              <textarea id="git-message" value={message} rows={3} onChange={event => changeMessage(event.target.value)}
                onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); confirmCommit(); } }}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className={touch} disabled={!git.selected.size || busy} onClick={generate}>{t('git.generate')}</Button><Button type="button" size="sm" className={touch} disabled={!git.selected.size || !message.trim() || busy} onClick={confirmCommit}>{t('git.actions.commit')}</Button></div>
              {generated && <div className="rounded-md border border-border p-2 text-sm"><p className="text-xs text-muted-foreground">{t('git.suggestion')}</p><p className="my-2 whitespace-pre-wrap break-words">{generated}</p><Button type="button" size="sm" variant="outline" className={touch} onClick={() => { changeMessage(generated); setGenerated(''); }}>{t('git.useSuggestion')}</Button></div>}
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2 text-xs text-muted-foreground"><span className="mr-auto">{t('git.selected', { count: git.selected.size, total: files.length })}</span><Button type="button" size="sm" variant="ghost" className={touch} disabled={busy} onClick={() => git.setSelected(new Set(files.map(item => item.file)))}>{t('git.all')}</Button><Button type="button" size="sm" variant="ghost" className={touch} disabled={busy} onClick={() => git.setSelected(new Set())}>{t('git.none')}</Button></div>
          {files.map(({ file, kind }) => <section key={file} className="border-b border-border py-2">
            <div className="flex min-w-0 items-start gap-1">
              <label className="flex h-11 w-9 shrink-0 items-center justify-center md:h-8"><input type="checkbox" checked={git.selected.has(file)} disabled={busy} aria-label={t('git.selectFile', { file })} onChange={() => git.setSelected(prev => { const next = new Set(prev); if (next.has(file)) next.delete(file); else next.add(file); return next; })} className="h-4 w-4 accent-[hsl(var(--foreground))]" /></label>
              <button type="button" onClick={() => onFileOpen && git.openFile(file, onFileOpen)} disabled={!onFileOpen} className={`min-w-0 flex-1 break-all py-2 text-left text-sm underline-offset-4 enabled:hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${touch}`} title={t('git.openFile', { file })}>{file}</button>
            </div>
            <div className="flex flex-wrap items-center gap-1 pl-9"><span className="mr-auto text-xs text-muted-foreground">{t(`git.status.${kind}`)}</span>
              <Button type="button" variant="ghost" size="sm" className={touch} aria-expanded={expanded.has(`file:${file}`)} onClick={() => toggle(`file:${file}`)}>{expanded.has(`file:${file}`) ? <ChevronDown /> : <ChevronRight />}{t('git.diff')}</Button>
              {kind !== 'added' && <Button type="button" variant="ghost" size="icon" className={`${touch} min-w-11 md:min-w-8`} disabled={busy} aria-label={t(kind === 'untracked' ? 'git.deleteFile' : 'git.discardFile', { file })} title={t(kind === 'untracked' ? 'git.deleteFile' : 'git.discardFile', { file })} onClick={() => confirm(kind === 'untracked' ? 'delete-untracked' : 'discard', { file })}>{kind === 'untracked' ? <Trash2 /> : <Undo2 />}</Button>}
            </div>
            {expanded.has(`file:${file}`) && <Diff workspace={git} kind="file" value={file} isMobile={isMobile} wrap={wrap} />}
          </section>)}
        </> : !git.errors.status && <p className="py-6 text-sm text-muted-foreground">{t('git.noChanges')}</p>}
      </>}
      {git.status && view === 'history' && <>
        <Failure message={git.errors.history} retry={() => git.load('history')} busy={git.loading.history} />
        {git.loading.history && !git.history.length && <p role="status" className="py-6 text-sm text-muted-foreground">{t('git.loading')}</p>}
        {!git.loading.history && !git.errors.history && !git.history.length && <p className="py-6 text-sm text-muted-foreground">{t('git.noCommits')}</p>}
        {git.history.map(commit => <section key={commit.hash} className="border-b border-border py-2">
          <button type="button" onClick={() => toggle(`commit:${commit.hash}`)} aria-expanded={expanded.has(`commit:${commit.hash}`)} className="flex min-h-11 w-full items-start gap-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {expanded.has(`commit:${commit.hash}`) ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}<span className="min-w-0 break-words">{commit.message}</span>
          </button><p className="flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground"><code title={commit.hash}>{commit.hash.slice(0, 7)}</code><span className="break-all">{commit.author}</span><time>{commit.date}</time></p>
          {commit.stats && <p className="mt-1 break-words pl-6 text-xs text-muted-foreground">{commit.stats}</p>}
          {expanded.has(`commit:${commit.hash}`) && <Diff workspace={git} kind="commit" value={commit.hash} isMobile={isMobile} wrap={wrap} />}
        </section>)}
      </>}
      {expanded.size > 0 && isMobile && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} />{t('git.wrap')}</label>}
    </div>
    {newBranch && <WorkbenchDialog title={t('git.newBranch')} busy={busy} onClose={() => { setNewBranch(false); git.clearActionError(); }}>
      <form onSubmit={async event => { event.preventDefault(); if (branch.trim() && !busy && await git.mutate('create-branch', { branch: branch.trim() })) { setNewBranch(false); setBranch(''); } }}>
        <label htmlFor="git-new-branch" className="block text-sm">{t('git.branchName')}</label><input id="git-new-branch" autoFocus value={branch} onChange={event => setBranch(event.target.value)} disabled={busy} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring" />
        <p className="mt-2 break-all text-xs text-muted-foreground">{t('git.branchFrom', { branch: currentBranch })}</p><Failure message={git.errors.action} />
        <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className={touch} disabled={busy} onClick={() => { setNewBranch(false); git.clearActionError(); }}>{t('git.cancel')}</Button><Button type="submit" className={touch} disabled={busy || !branch.trim()}>{t('git.actions.create-branch')}</Button></div>
      </form>
    </WorkbenchDialog>}
    {confirmation && <WorkbenchDialog title={t('git.confirm', { action: t(`git.actions.${confirmation.action}`) })} busy={busy} onClose={() => { setConfirmation(null); git.clearActionError(); }}>
      <p className="break-words text-sm text-muted-foreground">{t(`git.confirmations.${confirmation.action}`, { file: confirmation.payload.file, branch: currentBranch, count: confirmation.payload.files?.length })}</p>
      {confirmation.payload.message && <p className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border p-3 text-sm">{confirmation.payload.message}</p>}
      <Failure message={git.errors.action} />
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className={touch} disabled={busy} onClick={() => { setConfirmation(null); git.clearActionError(); }}>{t('git.cancel')}</Button><Button type="button" className={touch} variant={['discard','delete-untracked'].includes(confirmation.action) ? 'destructive' : 'default'} disabled={busy} onClick={execute}>{t(`git.actions.${confirmation.action}`)}</Button></div>
    </WorkbenchDialog>}
  </div>;
}
