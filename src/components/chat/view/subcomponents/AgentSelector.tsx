import React, { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type { SessionProvider } from '../../../../types/app';
import type { ProviderAvailability } from '../../types/types';

export type ProviderDef = {
  id: SessionProvider;
  name: string;
  accent: string;
  ring: string;
  check: string;
};

interface AgentSelectorProps {
  providers: ProviderDef[];
  activeProvider: SessionProvider;
  providerAvailability: Record<SessionProvider, ProviderAvailability>;
  onSelect: (id: SessionProvider) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function AgentSelector({
  providers,
  activeProvider,
  providerAvailability,
  onSelect,
  t,
}: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeProviderDef = providers.find((p) => p.id === activeProvider);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all duration-150 ${
          activeProviderDef
            ? `${activeProviderDef.accent} ${activeProviderDef.ring} ring-1 bg-card/90 text-foreground`
            : 'border-border/50 bg-card/50 text-muted-foreground'
        }`}
      >
        <SessionProviderLogo provider={activeProvider} className="w-3.5 h-3.5 shrink-0" />
        <span>{activeProviderDef?.name || activeProvider}</span>
        <svg className="w-3 h-3 shrink-0 text-muted-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-48 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          {providers.map((p) => {
            const active = activeProvider === p.id;
            const unavailable = providerAvailability[p.id]?.cliAvailable === false;
            return (
              <button
                key={p.id}
                type="button"
                disabled={unavailable}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                  unavailable
                    ? 'opacity-35 cursor-not-allowed grayscale'
                    : active
                      ? 'bg-primary/8 text-foreground font-medium'
                      : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <SessionProviderLogo provider={p.id} className="w-4 h-4 shrink-0" />
                <span className="flex-1">{p.name}</span>
                {active && <Check className="w-3 h-3 text-primary" />}
                {unavailable && <span className="text-[9px] text-muted-foreground">N/A</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
