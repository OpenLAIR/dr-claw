import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../../contexts/ThemeContext';

type MermaidBlockProps = {
  source: string;
};

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;
const loadMermaid = (): Promise<MermaidModule> => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidPromise;
};

const MermaidBlock = ({ source }: MermaidBlockProps) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? 'dark' : 'default';
  const domId = 'mmd-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMermaid().then((mermaid) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const result = await mermaid.render(domId, source);
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error('[MermaidBlock] render failed', { source, err });
          setFailed(true);
          setSvg(null);
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, domId, theme]);

  const handleCopy = () => {
    const doSet = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(source).then(doSet).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = source;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch {
          /* legacy fallback best-effort */
        }
        document.body.removeChild(ta);
        doSet();
      });
    }
  };

  const copyButton = (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
      title={copied ? t('codeBlock.copied') : t('codeBlock.copy')}
      aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copy')}
    >
      {copied ? t('codeBlock.copied') : t('codeBlock.copy')}
    </button>
  );

  if (failed) {
    return (
      <div className="relative group my-2">
        {copyButton}
        <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 text-xs font-mono overflow-auto whitespace-pre">
          {source}
        </pre>
        <div className="mt-1 text-xs text-amber-500/90">{t('codeBlock.renderError')}</div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 rounded-lg border border-border/50 bg-background/40 p-4 text-xs text-muted-foreground">
        {t('codeBlock.rendering')}
      </div>
    );
  }

  return (
    <div className="relative group my-2">
      {copyButton}
      <div
        className="rounded-lg border border-border/40 bg-white dark:bg-neutral-900 p-4 overflow-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
};

export default MermaidBlock;
