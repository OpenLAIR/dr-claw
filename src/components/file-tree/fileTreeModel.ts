// Pure helpers behind the project file tree: ordering, name truncation,
// default expansion, search filtering and flattening into rows.

export interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string | null;
  isSymlink?: boolean;
  /** `null` means "not loaded yet": fetch on expand. */
  children?: FileTreeItem[] | null;
}

export type FileTreeRow =
  | { kind: 'item'; key: string; item: FileTreeItem; depth: number; expanded: boolean; parentPath: string | null }
  | { kind: 'loading' | 'error' | 'empty'; key: string; dirPath: string; depth: number };

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const isHiddenName = (name: string) => name.startsWith('.');

/**
 * Folders before files; inside each group, visible names before dotfiles
 * (so Survey/ … Promotion/ are not pushed down by .claude/ and friends),
 * then natural order so `fig2` sorts before `fig10`.
 */
export function compareTreeItems(a: FileTreeItem, b: FileTreeItem): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  const aHidden = isHiddenName(a.name);
  const bHidden = isHiddenName(b.name);
  if (aHidden !== bHidden) return aHidden ? 1 : -1;
  const byName = nameCollator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function sortTree(items: FileTreeItem[]): FileTreeItem[] {
  return [...items]
    .sort(compareTreeItems)
    .map((item) => (Array.isArray(item.children) ? { ...item, children: sortTree(item.children) } : item));
}

/**
 * Split a name for middle truncation: the head shrinks with an ellipsis while
 * the tail (end of the stem plus the extension) always stays visible, so
 * `…_seed_07.png` and `…_seed_08.png` remain distinguishable.
 */
export function splitNameForTruncation(name: string, tailLength = 12): { head: string; tail: string } {
  if (name.length <= tailLength + 4) return { head: name, tail: '' };
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  // Keep a few stem characters next to a long extension, but never the whole name.
  const keep = Math.min(Math.max(tailLength, Math.min(extension.length + 4, 24)), name.length - 4);
  return { head: name.slice(0, name.length - keep), tail: name.slice(name.length - keep) };
}

/**
 * Folders start collapsed so the first screen shows the project's top level.
 * The exception is a project whose only visible entry is a single folder
 * (a cloned repo inside a wrapper directory): opening it saves a click.
 */
export function getInitialExpandedPaths(items: FileTreeItem[]): Set<string> {
  const visible = items.filter((item) => !isHiddenName(item.name));
  if (visible.length === 1 && visible[0].type === 'directory') {
    return new Set([visible[0].path]);
  }
  return new Set();
}

/** Keep entries whose name matches, plus the folders leading to them. */
export function filterTree(items: FileTreeItem[], query: string): FileTreeItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.reduce<FileTreeItem[]>((result, item) => {
    const matches = item.name.toLowerCase().includes(needle);
    const children = item.type === 'directory' && Array.isArray(item.children) ? filterTree(item.children, needle) : [];
    if (matches || children.length > 0) {
      result.push({ ...item, children: item.type === 'directory' ? children : item.children });
    }
    return result;
  }, []);
}

/** Every folder in a (filtered) tree that has children to show. */
export function collectExpandablePaths(items: FileTreeItem[], into: Set<string> = new Set()): Set<string> {
  for (const item of items) {
    if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
      into.add(item.path);
      collectExpandablePaths(item.children, into);
    }
  }
  return into;
}

/**
 * Flatten the visible part of the tree into rows. Expanded folders get a
 * placeholder row while loading, after a failed load, or when empty.
 */
export function flattenTree(
  items: FileTreeItem[],
  expanded: ReadonlySet<string>,
  status: { loading?: ReadonlySet<string>; failed?: ReadonlySet<string> } = {},
  depth = 0,
  parentPath: string | null = null,
  rows: FileTreeRow[] = [],
): FileTreeRow[] {
  for (const item of items) {
    const isDir = item.type === 'directory';
    const isExpanded = isDir && expanded.has(item.path);
    rows.push({ kind: 'item', key: item.path, item, depth, expanded: isExpanded, parentPath });
    if (!isExpanded) continue;
    const childDepth = depth + 1;
    if (status.failed?.has(item.path)) {
      rows.push({ kind: 'error', key: `${item.path}::error`, dirPath: item.path, depth: childDepth });
    } else if (status.loading?.has(item.path) || item.children == null) {
      rows.push({ kind: 'loading', key: `${item.path}::loading`, dirPath: item.path, depth: childDepth });
    } else if (item.children.length === 0) {
      rows.push({ kind: 'empty', key: `${item.path}::empty`, dirPath: item.path, depth: childDepth });
    } else {
      flattenTree(item.children, expanded, status, childDepth, item.path, rows);
    }
  }
  return rows;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`;
}

/** Path shown in tooltips: relative to the project root when possible. */
export function toProjectRelativePath(fullPath: string, projectRoot?: string | null): string {
  if (!projectRoot) return fullPath;
  const root = projectRoot.replace(/[\\/]+$/, '');
  if (fullPath === root) return '.';
  if (fullPath.startsWith(`${root}/`) || fullPath.startsWith(`${root}\\`)) return fullPath.slice(root.length + 1);
  return fullPath;
}

/**
 * Short timestamp for the optional details column: time of day for today,
 * month and day for this year, otherwise the full date.
 */
export function formatShortTimestamp(value: string | null | undefined, now: Date = new Date(), locale?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
