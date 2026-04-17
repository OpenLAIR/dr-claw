import React, { Suspense, lazy, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useTranslation } from 'react-i18next';

import MermaidBlock from '../chat/view/subcomponents/MermaidBlock';
import { normalizeLatexDelimiters } from '../../utils/latexNormalizer';
import { cn } from '../../lib/utils';

export type MarkdownCodeBlockStyle = 'syntax' | 'plain';

export type MarkdownRendererProps = {
  children: string;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  components?: Components;
  codeBlockStyle?: MarkdownCodeBlockStyle;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const DEFAULT_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const DEFAULT_REHYPE_PLUGINS: PluggableList = [rehypeKatex];

const LazyPrism = lazy(async () => {
  const [{ Prism }, { oneDark }] = await Promise.all([
    import('react-syntax-highlighter'),
    import('react-syntax-highlighter/dist/esm/styles/prism'),
  ]);
  const Wrapped = (props: any) => <Prism style={oneDark} {...props} />;
  return { default: Wrapped };
});

const childrenToString = (children: React.ReactNode): string =>
  Array.isArray(children) ? children.join('') : String(children ?? '');

const InlineCode: React.FC<CodeBlockProps> = ({ className, children, ...props }) => (
  <code
    className={cn(
      'font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200',
      'dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words',
      className,
    )}
    {...props}
  >
    {children}
  </code>
);

type CopyButtonProps = { text: string; copyLabel: string; copiedLabel: string };

const CopyButton: React.FC<CopyButtonProps> = ({ text, copyLabel, copiedLabel }) => {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    const settle = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(settle).catch(() => fallbackCopy(text, settle));
    } else {
      fallbackCopy(text, settle);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
      title={copied ? copiedLabel : copyLabel}
      aria-label={copied ? copiedLabel : copyLabel}
    >
      {copied ? copiedLabel : copyLabel}
    </button>
  );
};

const fallbackCopy = (text: string, onDone: () => void) => {
  const ta = document.createElement('textarea');
  ta.value = text;
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
  onDone();
};

type SyntaxBlockProps = { language: string; raw: string; copyLabel: string; copiedLabel: string };

const SyntaxCodeBlock: React.FC<SyntaxBlockProps> = ({ language, raw, copyLabel, copiedLabel }) => {
  const showLangChip = language && language !== 'text';
  return (
    <div className="relative group my-2">
      {showLangChip && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}
      <CopyButton text={raw} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      <Suspense
        fallback={
          <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 text-sm font-mono overflow-auto whitespace-pre">
            {raw}
          </pre>
        }
      >
        <LazyPrism
          language={language}
          customStyle={{
            margin: 0,
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            padding: showLangChip ? '2rem 1rem 1rem 1rem' : '1rem',
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
          }}
        >
          {raw}
        </LazyPrism>
      </Suspense>
    </div>
  );
};

type PlainBlockProps = { language: string; children?: React.ReactNode };

const PlainCodeBlock: React.FC<PlainBlockProps> = ({ language, children }) => (
  <div className="my-2 rounded-lg overflow-hidden border border-border">
    {language && (
      <div className="bg-muted/60 px-3 py-1 text-xs text-muted-foreground font-mono border-b border-border">
        {language}
      </div>
    )}
    <pre className="bg-muted/30 p-3 overflow-x-auto text-xs">
      <code className="font-mono text-foreground/90">{children}</code>
    </pre>
  </div>
);

const buildCodeRenderer = (
  codeBlockStyle: MarkdownCodeBlockStyle,
  copyLabel: string,
  copiedLabel: string,
) => {
  const CodeRenderer: React.FC<CodeBlockProps> = ({ node, inline, className, children, ...rest }) => {
    const raw = childrenToString(children);
    const inlineDetected = inline || (node && node.type === 'inlineCode');

    if (inlineDetected) {
      return (
        <InlineCode className={className} {...rest}>
          {children}
        </InlineCode>
      );
    }

    const langMatch = /language-(\w+)/.exec(className || '');
    const language = langMatch ? langMatch[1] : 'text';

    if (language === 'mermaid') {
      return <MermaidBlock source={raw} />;
    }

    if (codeBlockStyle === 'plain') {
      return <PlainCodeBlock language={language}>{children}</PlainCodeBlock>;
    }
    return <SyntaxCodeBlock language={language} raw={raw} copyLabel={copyLabel} copiedLabel={copiedLabel} />;
  };
  return CodeRenderer;
};

const defaultMarkdownComponents: Components = {
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-border/70 pl-4 italic text-foreground/80 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-blue-600 dark:text-blue-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-border text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left text-xs font-semibold border border-border">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 align-top text-xs border border-border">{children}</td>
  ),
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  children,
  remarkPlugins,
  rehypePlugins,
  components,
  codeBlockStyle = 'syntax',
}) => {
  const { t } = useTranslation('chat');
  const copyLabel = t('codeBlock.copy');
  const copiedLabel = t('codeBlock.copied');

  const mergedComponents = useMemo<Components>(
    () => ({
      ...defaultMarkdownComponents,
      ...(components ?? {}),
      code: buildCodeRenderer(codeBlockStyle, copyLabel, copiedLabel),
    }),
    [codeBlockStyle, copyLabel, copiedLabel, components],
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins ?? DEFAULT_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins ?? DEFAULT_REHYPE_PLUGINS}
      components={mergedComponents}
    >
      {normalizeLatexDelimiters(children ?? '')}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;
