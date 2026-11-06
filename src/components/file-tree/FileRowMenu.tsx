import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../lib/utils';

export interface FileRowMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface FileRowMenuProps {
  /** Viewport point to open at: the trigger's bottom-right corner, or the cursor for a right-click. */
  anchor: { x: number; y: number };
  items: FileRowMenuItem[];
  label: string;
  /** The button that opened the menu; pressing it again toggles the menu closed instead of reopening it. */
  trigger?: HTMLElement | null;
  onClose: (restoreFocus: boolean) => void;
}

const MENU_WIDTH = 200;
const MARGIN = 8;

/**
 * Small action menu for a file tree row. It renders into <body> so the tree's
 * scroll container cannot clip it, flips above the anchor near the bottom of
 * the window, and supports arrow keys, Home/End, Escape and Tab.
 */
export default function FileRowMenu({ anchor, items, label, trigger, onClose }: FileRowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const height = menuRef.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(MARGIN, anchor.x - MENU_WIDTH), window.innerWidth - MENU_WIDTH - MARGIN);
    const fitsBelow = anchor.y + height + MARGIN <= window.innerHeight;
    const top = fitsBelow ? anchor.y + 4 : Math.max(MARGIN, anchor.y - height - 4);
    setPosition({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || trigger?.contains(target)) return;
      onClose(false);
    };
    const handleBlur = () => onClose(false);
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleBlur);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleBlur);
    };
  }, [onClose, trigger]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => buttons[(next + buttons.length) % buttons.length]?.focus();
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusAt(index + 1); break;
      case 'ArrowUp': event.preventDefault(); focusAt(index - 1); break;
      case 'Home': event.preventDefault(); focusAt(0); break;
      case 'End': event.preventDefault(); focusAt(buttons.length - 1); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); onClose(true); break;
      case 'Tab': event.preventDefault(); onClose(true); break;
      default: break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      style={{ width: MENU_WIDTH, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      className="fixed z-[200] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => { onClose(false); item.onSelect(); }}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors',
            'hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50',
            item.destructive && 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10',
          )}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
