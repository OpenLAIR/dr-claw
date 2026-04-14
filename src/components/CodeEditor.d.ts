import type { JSX } from 'react';
import type { DiffInfo } from './main-content/types/types';
import type { Project } from '../types/app';

interface CodeEditorFile {
  name: string;
  path: string;
  projectName?: string;
  diffInfo?: DiffInfo | null;
  [key: string]: unknown;
}

interface CodeEditorProps {
  file: CodeEditorFile;
  onClose: () => void;
  projectPath?: string;
  selectedProject?: Project | null;
  onStartWorkspaceQa?: ((project: Project, prompt: string) => void) | null;
  displayMode?: 'sidebar' | 'modal' | 'embedded';
  isSidebar?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (() => void) | null;
  onPopOut?: (() => void) | null;
}

declare function CodeEditor(props: CodeEditorProps): JSX.Element;
export default CodeEditor;
