import { useTranslation } from 'react-i18next';
import LanguageSelector from '../LanguageSelector';
import WorkspaceRootSettings from './WorkspaceRootSettings';

export default function AppearanceContent({ values, actions }) {
  const { t } = useTranslation('settings');
  const row = (label, description, control) => <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 last:border-0"><div className="min-w-0 flex-1 basis-48 space-y-1"><div className="font-medium">{label}</div><p className="text-sm text-muted-foreground">{description}</p></div>{control}</div>;
  const toggle = (key, label) => <button type="button" role="switch" aria-checked={values[key]} aria-label={label} onClick={() => actions[key](!values[key])} className={`inline-flex min-h-11 min-w-20 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${values[key] ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-muted-foreground'}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${values[key] ? 'bg-current' : 'border border-current'}`} />{t(values[key] ? 'appearanceSettings.enabled' : 'appearanceSettings.disabled')}</button>;
  const controlClass = 'min-h-11 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <section data-appearance-settings className="space-y-6">
    <p className="text-sm text-muted-foreground">{t('appearanceSettings.saveBehavior')}</p>
    <div>
      {row(t('appearanceSettings.darkMode.label'), t('appearanceSettings.darkMode.description'), toggle('dark', t('appearanceSettings.darkMode.action')))}
      {row(t('appearanceSettings.telemetry.label'), t('appearanceSettings.telemetry.description'), toggle('telemetry', t('appearanceSettings.telemetry.label')))}
    </div>
    <LanguageSelector />
    {row(t('appearanceSettings.projectSorting.label'), t('appearanceSettings.projectSorting.description'), <select aria-label={t('appearanceSettings.projectSorting.label')} value={values.sort} onChange={event => actions.sort(event.target.value)} className={controlClass}><option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option><option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option></select>)}
    <WorkspaceRootSettings />
    <div><h3 className="text-lg font-semibold">{t('appearanceSettings.codeEditor.title')}</h3>
      {row(t('appearanceSettings.codeEditor.theme.label'), t('appearanceSettings.codeEditor.theme.description'), toggle('editorDark', t('appearanceSettings.codeEditor.theme.action')))}
      {['wordWrap', 'showMinimap', 'lineNumbers'].map(key => <div key={key}>{row(t(`appearanceSettings.codeEditor.${key}.label`), t(`appearanceSettings.codeEditor.${key}.description`), toggle(key, t(`appearanceSettings.codeEditor.${key}.label`)))}</div>)}
      {row(t('appearanceSettings.codeEditor.fontSize.label'), t('appearanceSettings.codeEditor.fontSize.description'), <select aria-label={t('appearanceSettings.codeEditor.fontSize.label')} value={values.fontSize} onChange={event => actions.fontSize(event.target.value)} className={controlClass}>{[10,11,12,13,14,15,16,18,20].map(size => <option value={size} key={size}>{size}px</option>)}</select>)}
    </div>
  </section>;
}
