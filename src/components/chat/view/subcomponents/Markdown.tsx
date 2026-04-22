import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import MermaidBlock from './MermaidBlock';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  onFileOpen?: (filePath: string) => void;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${
          className || ''
        }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  if (language === 'mermaid') {
    return <MermaidBlock source={raw} />;
  }

  const textToCopy = raw;

  const handleCopy = () => {
    const doSet = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(doSet).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
          } catch {}
          document.body.removeChild(ta);
          doSet();
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch {}
        document.body.removeChild(ta);
        doSet();
      }
    } catch {}
  };

  return (
    <div className="relative group my-2">
      {language && language !== 'text' && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}

      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

// ── Insight callout ──────────────────────────────────────────────────────────
// Matches blocks like:
//   ★ Insight ─────────────────────────────────────
//   - point 1
//   - point 2
//   ─────────────────────────────────────────────────
const INSIGHT_BLOCK_RE = /`?★\s*Insight\s*─+`?\n([\s\S]*?)\n`?─{10,}`?/g;

type InsightSegment = { kind: 'text'; value: string } | { kind: 'insight'; value: string };

function splitInsightBlocks(content: string): InsightSegment[] {
  const segments: InsightSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INSIGHT_BLOCK_RE.lastIndex = 0;
  while ((match = INSIGHT_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: content.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'insight', value: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', value: content.slice(lastIndex) });
  }
  return segments;
}

function InsightCallout({ children }: { children: string }) {
  return (
    <div className="my-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30">
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <svg className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM4 11a1 1 0 100-2H3a1 1 0 000 2h1zM10 18a1 1 0 001-1v-1a1 1 0 10-2 0v1a1 1 0 001 1zM15.657 14.243a1 1 0 00-1.414 0l-.707.707a1 1 0 101.414 1.414l.707-.707a1 1 0 000-1.414zM6.464 14.95a1 1 0 10-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM10 5a5 5 0 00-3 9v1a1 1 0 001 1h4a1 1 0 001-1v-1a5 5 0 00-3-9z" />
        </svg>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Insight</span>
      </div>
      <div className="px-3 pb-2.5 text-sm text-amber-900 dark:text-amber-100/90 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_li]:leading-relaxed [&_strong]:font-semibold [&_code]:bg-amber-100 [&_code]:dark:bg-amber-900/40 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em]">
        <InsightContent>{children}</InsightContent>
      </div>
    </div>
  );
}

function InsightContent({ children }: { children: string }) {
  const lines = children.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.replace(/^[-*]\s+/, '');
        const isList = /^[-*]\s+/.test(line);
        const rendered = trimmed
          .split(/(\*\*.*?\*\*|`[^`]+`)/)
          .map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j}>{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
              return <code key={j}>{part.slice(1, -1)}</code>;
            }
            return <React.Fragment key={j}>{part}</React.Fragment>;
          });
        if (isList) {
          return <div key={i} className="flex gap-1.5"><span className="text-amber-400 dark:text-amber-500 select-none">•</span><span>{rendered}</span></div>;
        }
        return <div key={i}>{rendered}</div>;
      })}
    </>
  );
}

// Detect file path patterns like "src/lib.rs:36", "README.md", "package.json"
// Also matches known extensionless files like Dockerfile, Makefile, etc.
const EXTENSIONLESS_FILES = /(?:Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Vagrantfile|Brewfile|Guardfile|Justfile|Taskfile)$/;
const FILE_PATH_RE = /^([\w./@\\-][\w./@ \\-]*\.\w{1,10})(:\d+)?$/;

function isFilePath(text: string): boolean {
  const trimmed = text.trim();
  return FILE_PATH_RE.test(trimmed) || EXTENSIONLESS_FILES.test(trimmed);
}

function parseFilePath(text: string): { filePath: string; line?: string } {
  const match = text.trim().match(FILE_PATH_RE);
  if (!match) return { filePath: text.trim() };
  return { filePath: match[1], line: match[2] };
}

const markdownComponents = {
  code: CodeBlock,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
  ),
};

export function Markdown({ children, className, onFileOpen }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  const components = useMemo(() => {
    if (!onFileOpen) return markdownComponents;

    return {
      ...markdownComponents,
      // Make markdown links open as files if href looks like a file path
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        if (href && !/^(?:https?:|mailto:|tel:|#)/.test(href)) {
          // Strip fragment (e.g. #L1) before checking if it's a file path
          const hrefWithoutFragment = href.replace(/#.*$/, '');
          if (isFilePath(hrefWithoutFragment)) {
            const { filePath } = parseFilePath(hrefWithoutFragment);
            return (
              <button
                onClick={() => onFileOpen(filePath)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                title={`Open ${filePath}`}
              >
                {linkChildren}
              </button>
            );
          }
        }
        return (
          <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            {linkChildren}
          </a>
        );
      },
      // Make bold text clickable if it looks like a file path
      strong: ({ children: strongChildren }: { children?: React.ReactNode }) => {
        const text = typeof strongChildren === 'string'
          ? strongChildren
          : Array.isArray(strongChildren)
            ? strongChildren.map(c => (typeof c === 'string' ? c : '')).join('')
            : '';
        if (text && isFilePath(text)) {
          const { filePath } = parseFilePath(text);
          return (
            <button
              onClick={() => onFileOpen(filePath)}
              className="font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
              title={`Open ${filePath}`}
            >
              {strongChildren}
            </button>
          );
        }
        return <strong>{strongChildren}</strong>;
      },
      // Make inline code clickable if it looks like a file path
      code: (props: CodeBlockProps) => {
        const { node, inline, children: codeChildren } = props;
        const raw = Array.isArray(codeChildren) ? codeChildren.join('') : String(codeChildren ?? '');
        const inlineDetected = inline || (node && node.type === 'inlineCode');
        const looksMultiline = /[\r\n]/.test(raw);
        const shouldInline = inlineDetected || !looksMultiline;

        if (shouldInline && isFilePath(raw)) {
          const { filePath } = parseFilePath(raw);
          return (
            <span
              role="button"
              tabIndex={0}
              onClick={() => onFileOpen(filePath)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onFileOpen(filePath); }}
              className="font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:underline cursor-pointer transition-colors"
              title={`Open ${filePath}`}
            >
              {codeChildren}
            </span>
          );
        }

        return <CodeBlock {...props} />;
      },
    };
  }, [onFileOpen]);

  const segments = useMemo(() => splitInsightBlocks(content), [content]);
  const hasInsights = segments.some(s => s.kind === 'insight');

  if (!hasInsights) {
    return (
      <div className={className}>
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.kind === 'insight' ? (
          <InsightCallout key={i}>{seg.value}</InsightCallout>
        ) : (
          <ReactMarkdown key={i} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
            {seg.value}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
