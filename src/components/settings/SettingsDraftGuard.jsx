import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import WorkbenchDialog from '../ui/WorkbenchDialog';
import { Button } from '../ui/button';

const DraftContext = createContext(null);

export function SettingsDraftProvider({ children }) {
  const { t } = useTranslation('settings');
  const entries = useRef(new Map());
  const [pending, setPending] = useState(null);
  const [, refresh] = useState(0);
  const register = useCallback((id, entry) => {
    const previous = entries.current.get(id);
    entries.current.set(id, entry);
    if (previous?.dirty !== entry.dirty || previous?.busy !== entry.busy || previous?.warning !== entry.warning) refresh(value => value + 1);
  }, []);
  const remove = useCallback(id => { if (entries.current.delete(id)) refresh(value => value + 1); }, []);
  const request = useCallback(action => {
    if ([...entries.current.values()].some(entry => entry.dirty || entry.busy)) setPending(() => action);
    else action();
  }, []);
  const context = useMemo(() => ({ register, remove, request }), [register, remove, request]);
  useEffect(() => {
    const beforeUnload = event => {
      if ([...entries.current.values()].some(entry => entry.dirty || entry.busy)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const busy = [...entries.current.values()].some(entry => entry.busy);
  const dirty = [...entries.current.values()].some(entry => entry.dirty);
  useEffect(() => {
    if (pending && !busy && !dirty) {
      const action = pending;
      setPending(null);
      requestAnimationFrame(action);
    }
  }, [pending, busy, dirty]);
  const keyWarning = [...entries.current.values()].some(entry => entry.dirty && entry.warning === 'key');
  const keepEditing = () => setPending(null);
  return <DraftContext.Provider value={context}>
    {children}
    {pending && <WorkbenchDialog title={t(busy ? 'unsaved.busyTitle' : 'unsaved.title')} onClose={keepEditing}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(busy ? 'unsaved.busyDescription' : keyWarning ? 'unsaved.keyDescription' : 'unsaved.description')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button autoFocus variant="outline" className="min-h-11 whitespace-normal" onClick={keepEditing}>{t('unsaved.keepEditing')}</Button>
          {!busy && <Button variant="destructive" className="min-h-11 whitespace-normal" onClick={() => {
            const action = pending;
            for (const entry of entries.current.values()) if (entry.dirty) entry.discard?.();
            setPending(null);
            // Let the confirmation return focus before switching or closing its owner.
            requestAnimationFrame(action);
          }}>{t(keyWarning ? 'unsaved.leave' : 'unsaved.discard')}</Button>}
        </div>
      </div>
    </WorkbenchDialog>}
  </DraftContext.Provider>;
}

export function useSettingsDraft(dirty, { busy = false, discard, warning } = {}) {
  const context = useContext(DraftContext);
  const id = useId();
  useLayoutEffect(() => { context?.register(id, { dirty: Boolean(dirty), busy: Boolean(busy), discard, warning }); });
  useLayoutEffect(() => () => context?.remove(id), [context, id]);
}

export function useSettingsNavigation() {
  const context = useContext(DraftContext);
  return context?.request || (action => action());
}
