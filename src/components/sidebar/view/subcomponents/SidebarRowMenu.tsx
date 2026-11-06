import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../../../lib/utils';

export type SidebarRowMenuItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Extra classes for the icon, e.g. a filled star. */
  iconClassName?: string;
};

type SidebarRowMenuProps = {
  label: string;
  items: SidebarRowMenuItem[];
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Row actions on pointer layouts: collapsed until the row is hovered or holds
 * keyboard focus. They are squeezed to zero width rather than `display: none`
 * so Tab can still land on them and reveal them.
 */
export const revealRowActionsClass = (menuOpen: boolean) =>
  menuOpen
    ? 'md:w-auto md:overflow-visible md:opacity-100'
    : [
      'md:w-0 md:overflow-hidden md:opacity-0',
      'md:group-hover:w-auto md:group-hover:overflow-visible md:group-hover:opacity-100',
      'md:group-has-[:focus-visible]:w-auto md:group-has-[:focus-visible]:overflow-visible md:group-has-[:focus-visible]:opacity-100',
    ].join(' ');

const MENU_WIDTH = 192;
const VIEWPORT_MARGIN = 8;

/**
 * "…" button that opens a small action menu. The menu is portalled to the
 * body so the sidebar's scroll container cannot clip it.
 */
export default function SidebarRowMenu({ label, items, triggerClassName, onOpenChange }: SidebarRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const changeOpen = useCallback((next: boolean, { restoreFocus = true } = {}) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setPosition(null);
      if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    }
  }, [onOpenChange]);

  const openMenu = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPosition({ top: rect.bottom + 4, left });
    changeOpen(true);
  };

  // Flip above the trigger when there is no room below, then focus the first item.
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const rect = trigger.current?.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    if (rect && rect.bottom + 4 + height > window.innerHeight - VIEWPORT_MARGIN) {
      setPosition((current) => current && { ...current, top: Math.max(VIEWPORT_MARGIN, rect.top - height - 4) });
    }
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      changeOpen(false, { restoreFocus: false });
    };
    // The menu is positioned once; close it rather than let it drift.
    const closeWithoutFocus = () => changeOpen(false, { restoreFocus: false });
    const closeOnScroll = (event: Event) => {
      if (menu.current?.contains(event.target as Node)) return;
      closeWithoutFocus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeWithoutFocus);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeWithoutFocus);
    };
  }, [changeOpen, open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next !== null) {
      event.preventDefault();
      enabled[next].focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) changeOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && position && createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          data-sidebar-row-menu
          className="fixed z-[80] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              changeOpen(false);
              return;
            }
            // Tab leaves the menu from its trigger, like a native menu button.
            if (event.key === 'Tab') {
              changeOpen(false);
              return;
            }
            moveFocus(event);
          }}
        >
          {items.map(({ key, label: itemLabel, icon: Icon, onSelect, destructive, disabled, iconClassName }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              disabled={disabled}
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm outline-none md:h-8',
                'hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50',
                destructive ? 'text-destructive' : 'text-popover-foreground',
              )}
              onClick={(event) => {
                event.stopPropagation();
                // Return focus first so a rename editor or dialog can take it next.
                changeOpen(false);
                onSelect();
              }}
            >
              <Icon className={cn('h-4 w-4 shrink-0', !destructive && 'text-muted-foreground', iconClassName)} />
              <span className="truncate">{itemLabel}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
