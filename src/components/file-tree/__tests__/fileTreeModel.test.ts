import { describe, expect, it } from 'vitest';

import {
  collectExpandablePaths,
  filterTree,
  flattenTree,
  formatFileSize,
  formatShortTimestamp,
  getInitialExpandedPaths,
  sortTree,
  splitNameForTruncation,
  toProjectRelativePath,
  type FileTreeItem,
} from '../fileTreeModel';

const file = (path: string): FileTreeItem => ({ name: path.split('/').pop()!, path, type: 'file' });
const dir = (path: string, children: FileTreeItem[] | null = []): FileTreeItem => ({
  name: path.split('/').pop()!,
  path,
  type: 'directory',
  children,
});

describe('sortTree', () => {
  it('puts folders first, dotfiles after visible names, and uses natural order', () => {
    const sorted = sortTree([
      file('/p/README.md'),
      dir('/p/.claude'),
      file('/p/.gitignore'),
      dir('/p/Survey'),
      dir('/p/Experiment'),
      file('/p/fig10.png'),
      file('/p/fig2.png'),
      dir('/p/.agents'),
    ]);
    expect(sorted.map((item) => item.name)).toEqual([
      'Experiment', 'Survey', '.agents', '.claude', 'fig2.png', 'fig10.png', 'README.md', '.gitignore',
    ]);
  });

  it('sorts loaded children and leaves unloaded folders alone', () => {
    const sorted = sortTree([dir('/p/a', [file('/p/a/b10'), file('/p/a/b9')]), dir('/p/link', null)]);
    expect(sorted[0].children?.map((item) => item.name)).toEqual(['b9', 'b10']);
    expect(sorted[1].children).toBeNull();
  });

  it('does not mutate the input', () => {
    const input = [file('/p/b'), file('/p/a')];
    sortTree(input);
    expect(input.map((item) => item.name)).toEqual(['b', 'a']);
  });
});

describe('splitNameForTruncation', () => {
  it('keeps short names whole', () => {
    expect(splitNameForTruncation('main.tex')).toEqual({ head: 'main.tex', tail: '' });
  });

  it('keeps the end of the stem and the extension in the tail', () => {
    const name = '2024_paper_01_calibration_of_large_language_models_under_distribution_shift.pdf';
    const { head, tail } = splitNameForTruncation(name);
    expect(head + tail).toBe(name);
    expect(tail).toBe('on_shift.pdf');
    expect(tail.endsWith('.pdf')).toBe(true);
  });

  it('keeps distinguishing suffixes visible', () => {
    expect(splitNameForTruncation('reliability_diagram_seed_07.png').tail).toBe('_seed_07.png');
  });

  it('grows the tail for long extensions and never swallows the whole name', () => {
    const { head, tail } = splitNameForTruncation('archive_of_everything.backup-2024-11-05');
    expect(tail).toBe('hing.backup-2024-11-05');
    expect(head.length).toBeGreaterThan(0);
  });

  it('treats a leading dot as part of the name, not an extension', () => {
    const { head, tail } = splitNameForTruncation('.env.production.local.backup');
    expect(head + tail).toBe('.env.production.local.backup');
    expect(tail).toBe('local.backup');
  });
});

describe('getInitialExpandedPaths', () => {
  it('starts with every folder collapsed', () => {
    expect(getInitialExpandedPaths([dir('/p/Survey'), dir('/p/Experiment'), file('/p/README.md')]).size).toBe(0);
  });

  it('opens a lone wrapper folder, ignoring dotfiles', () => {
    expect([...getInitialExpandedPaths([dir('/p/repo'), dir('/p/.claude'), file('/p/.gitignore')])]).toEqual(['/p/repo']);
  });

  it('does not open a lone file or an empty project', () => {
    expect(getInitialExpandedPaths([file('/p/a.txt')]).size).toBe(0);
    expect(getInitialExpandedPaths([]).size).toBe(0);
  });
});

describe('filterTree and collectExpandablePaths', () => {
  const tree = [
    dir('/p/Survey', [dir('/p/Survey/papers', [file('/p/Survey/papers/calibration.pdf'), file('/p/Survey/papers/other.pdf')])]),
    dir('/p/Experiment', [file('/p/Experiment/train.py')]),
    file('/p/README.md'),
  ];

  it('keeps matches and their ancestors only', () => {
    const filtered = filterTree(tree, 'CALIB');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].children?.[0].children?.map((item) => item.name)).toEqual(['calibration.pdf']);
  });

  it('returns the tree unchanged for a blank query', () => {
    expect(filterTree(tree, '  ')).toBe(tree);
  });

  it('collects folders that have something to show', () => {
    expect([...collectExpandablePaths(filterTree(tree, 'calib'))]).toEqual(['/p/Survey', '/p/Survey/papers']);
  });
});

describe('flattenTree', () => {
  const tree = [
    dir('/p/Survey', [dir('/p/Survey/papers', [file('/p/Survey/papers/a.pdf')]), file('/p/Survey/notes.md')]),
    dir('/p/empty', []),
    dir('/p/.claude/skills/x', null),
    file('/p/README.md'),
  ];

  it('lists only the top level when nothing is expanded', () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((row) => row.key)).toEqual(['/p/Survey', '/p/empty', '/p/.claude/skills/x', '/p/README.md']);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });

  it('nests expanded folders with depth and parent', () => {
    const rows = flattenTree(tree, new Set(['/p/Survey', '/p/Survey/papers']));
    expect(rows.map((row) => [row.key, row.depth])).toEqual([
      ['/p/Survey', 0],
      ['/p/Survey/papers', 1],
      ['/p/Survey/papers/a.pdf', 2],
      ['/p/Survey/notes.md', 1],
      ['/p/empty', 0],
      ['/p/.claude/skills/x', 0],
      ['/p/README.md', 0],
    ]);
    const pdf = rows[2];
    expect(pdf.kind === 'item' && pdf.parentPath).toBe('/p/Survey/papers');
  });

  it('adds placeholder rows for empty, unloaded and failed folders', () => {
    const rows = flattenTree(tree, new Set(['/p/empty', '/p/.claude/skills/x']));
    expect(rows.filter((row) => row.kind !== 'item').map((row) => [row.kind, row.depth])).toEqual([
      ['empty', 1],
      ['loading', 1],
    ]);
    const failed = flattenTree(tree, new Set(['/p/.claude/skills/x']), { failed: new Set(['/p/.claude/skills/x']) });
    expect(failed.some((row) => row.kind === 'error')).toBe(true);
  });
});

describe('formatFileSize', () => {
  it('formats bytes compactly', () => {
    expect(formatFileSize(undefined)).toBe('—');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB');
  });
});

describe('toProjectRelativePath', () => {
  it('strips the project root', () => {
    expect(toProjectRelativePath('/home/u/proj/Survey/a.pdf', '/home/u/proj/')).toBe('Survey/a.pdf');
    expect(toProjectRelativePath('/home/u/proj', '/home/u/proj')).toBe('.');
    expect(toProjectRelativePath('/elsewhere/a', '/home/u/proj')).toBe('/elsewhere/a');
    expect(toProjectRelativePath('/home/u/project2/a', '/home/u/proj')).toBe('/home/u/project2/a');
  });
});

describe('formatShortTimestamp', () => {
  const now = new Date(2026, 10, 5, 21, 30);

  it('shows the time for today, the day for this year, and the full date otherwise', () => {
    expect(formatShortTimestamp(new Date(2026, 10, 5, 9, 5).toISOString(), now, 'en-GB')).toBe('09:05');
    expect(formatShortTimestamp(new Date(2026, 2, 14).toISOString(), now, 'en-US')).toBe('Mar 14');
    expect(formatShortTimestamp(new Date(2024, 0, 2).toISOString(), now, 'en-US')).toBe('Jan 2, 2024');
  });

  it('handles missing and invalid values', () => {
    expect(formatShortTimestamp(null, now)).toBe('—');
    expect(formatShortTimestamp('not a date', now)).toBe('—');
  });
});
