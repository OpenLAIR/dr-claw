import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { TaskMasterTask } from '../../main-content/types/types';

export type OutputFile = { name: string; path: string; relativePath: string; modified?: number };
type FileNode = { name: string; path: string; type: string; children?: FileNode[]; modified?: string | number };
export type OverviewData = { tasks: TaskMasterTask[]; goal: string; files: OutputFile[]; errors: string[] };

export function flattenFiles(nodes: FileNode[], root: string): OutputFile[] {
  const prefix = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return nodes.flatMap(node => {
    if (node.type === 'directory') return flattenFiles(node.children ?? [], root);
    if (node.type !== 'file') return [];
    const path = node.path.replace(/\\/g, '/');
    const time = node.modified ? new Date(node.modified).getTime() : NaN;
    return [{ name: node.name, path: node.path, relativePath: path.startsWith(prefix) ? path.slice(prefix.length) : path, modified: Number.isFinite(time) ? time : undefined }];
  });
}

export async function loadOverview(project: Project): Promise<OverviewData> {
  const errors: string[] = [];
  const [tasksResult, filesResult] = await Promise.allSettled([
    api.get(`/taskmaster/tasks/${encodeURIComponent(project.name)}`).then(async response => {
      if (!response.ok) throw new Error('tasks');
      const data = await response.json();
      return Array.isArray(data.tasks) ? data.tasks as TaskMasterTask[] : [];
    }),
    api.getFiles(project.name, { maxDepth: 10 }).then(async response => {
      if (!response.ok) throw new Error('files');
      const data = await response.json();
      return flattenFiles(Array.isArray(data) ? data : [], project.fullPath || project.path || '');
    }),
  ]);
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : (errors.push('tasks'), []);
  const allFiles = filesResult.status === 'fulfilled' ? filesResult.value : (errors.push('files'), []);
  let goal = '';
  if (allFiles.some(file => file.relativePath === '.pipeline/docs/research_brief.json')) {
    try {
      const response = await api.readFile(project.name, '.pipeline/docs/research_brief.json');
      if (!response.ok) throw new Error('brief');
      const data = await response.json();
      const brief = JSON.parse(data.content);
      const value = brief?.sections?.ideation?.research_goal;
      goal = typeof value === 'string' ? value.trim() : '';
    } catch { errors.push('brief'); }
  }
  const files = allFiles.filter(file => /^(Survey|Research|Ideation|Experiment|Publication|Promotion|Presentation)\//.test(file.relativePath)
    && !/(^|\/)(node_modules|\.git|__pycache__|datasets)\//.test(file.relativePath));
  files.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.relativePath.localeCompare(b.relativePath));
  return { tasks, goal, files, errors };
}
