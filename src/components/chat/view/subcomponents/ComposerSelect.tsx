import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ComposerSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  meta?: string;
}

/** Shared presentation and keyboard behavior for conversation configuration. */
export default function ComposerSelect({ label, value, options, onChange, onClose, title, className = '' }: {
  label: string;
  value: string;
  options: ComposerSelectOption[];
  onChange: (value: string) => void;
  onClose?: () => void;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const close = () => { setOpen(false); onClose?.(); };
  useEffect(() => {
    if (!open) return;
    const selectedItem = root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
    (selectedItem || root.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)'))?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return <div ref={root} className={`relative composer-select ${className}`}
    onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <span className="composer-select-label">{label}</span>
    <button ref={trigger} type="button" className="composer-select-trigger" title={title}
      aria-label={title || `${label}: ${selected?.label || value}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(previous => !previous)}>
      {selected?.icon && <span aria-hidden="true" className="composer-select-icon">{selected.icon}</span>}
      <span className="min-w-0 flex-1 truncate">{selected?.label || value}</span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
    {open && <div id={id} role="listbox" aria-label={label} className="bottom-full composer-select-menu">
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={value === option.value}
        disabled={option.disabled} className="composer-select-option" title={option.description || option.value}
        onClick={() => { onChange(option.value); close(); trigger.current?.focus(); }}>
        {option.icon && <span aria-hidden="true" className="composer-select-icon">{option.icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium">{option.label}</span>
          {option.description && <span className="composer-select-description">{option.description}</span>}
          {option.meta && <span className="composer-select-description">{option.meta}</span>}
        </span>
        <span className="w-4 shrink-0">{value === option.value && <Check aria-hidden="true" className="h-4 w-4" />}</span>
      </button>)}
    </div>}
  </div>;
}
