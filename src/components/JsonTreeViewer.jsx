import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function formatPrimitive(value) {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'undefined') {
    return 'undefined';
  }
  return String(value);
}

function valueClassName(value) {
  if (value === null) return 'text-slate-500 dark:text-slate-400';
  switch (typeof value) {
    case 'string':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'number':
      return 'text-sky-700 dark:text-sky-300';
    case 'boolean':
      return 'text-violet-700 dark:text-violet-300';
    default:
      return 'text-foreground';
  }
}

function getNodeSummary(value) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value && typeof value === 'object') {
    return `Object(${Object.keys(value).length})`;
  }
  return formatPrimitive(value);
}

function JsonNode({ label, value, path, depth, defaultExpandDepth }) {
  const isCollection = Boolean(value) && typeof value === 'object';
  const startsExpanded = depth < defaultExpandDepth;
  const [expanded, setExpanded] = useState(startsExpanded);

  if (!isCollection) {
    return (
      <div className="flex items-start gap-2 py-0.5 leading-6">
        <span className="min-w-0 shrink truncate font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className={valueClassName(value)}>{formatPrimitive(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-1 rounded-md px-1 py-0.5 text-left hover:bg-slate-100/80 dark:hover:bg-slate-800/70"
      >
        <span className="mt-1 text-slate-500 dark:text-slate-400">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 shrink truncate font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{getNodeSummary(value)}</span>
      </button>
      {expanded ? (
        <div className="ml-4 border-l border-slate-200 pl-3 dark:border-slate-700">
          {entries.map(([childKey, childValue]) => (
            <JsonNode
              key={`${path}.${childKey}`}
              label={Array.isArray(value) ? `[${childKey}]` : childKey}
              value={childValue}
              path={`${path}.${childKey}`}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function JsonTreeViewer({
  content,
  defaultExpandDepth = 1,
  className = '',
  invalidFallbackClassName = '',
}) {
  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(content), error: null };
    } catch (error) {
      return { value: null, error };
    }
  }, [content]);

  if (parsed.error) {
    return (
      <pre className={`overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/80 p-5 font-mono text-sm text-foreground shadow-sm ${invalidFallbackClassName}`.trim()}>
        {content}
      </pre>
    );
  }

  return (
    <div className={`overflow-auto rounded-xl border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))] p-4 font-mono text-sm shadow-sm dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.92))] ${className}`.trim()}>
      <JsonNode
        label={Array.isArray(parsed.value) ? '[root]' : '{root}'}
        value={parsed.value}
        path="root"
        depth={0}
        defaultExpandDepth={defaultExpandDepth}
      />
    </div>
  );
}
