import {
  Archive, BookMarked, BookOpen, Binary, Blocks, Box, Braces, Code2, Coffee, Cog, Cpu, Database, File, FileCheck,
  FileCode, FileCode2, FileSpreadsheet, FileText, FileType, Flame, FlaskConical, Gem, Globe, Hash, Hexagon, Image,
  Lock, Music2, NotebookPen, Palette, Presentation, Scroll, Settings, Shield, SquareFunction, Terminal, Video, Workflow,
  type LucideIcon,
} from 'lucide-react';

// Tints are muted on purpose: they help scan a long list without turning the
// tree into a rainbow. Each tone has a light and a dark variant.
const TONE = {
  neutral: 'text-muted-foreground',
  code: 'text-sky-600 dark:text-sky-400',
  python: 'text-blue-600 dark:text-blue-400',
  data: 'text-amber-600 dark:text-amber-400',
  doc: 'text-slate-500 dark:text-slate-400',
  pdf: 'text-rose-600 dark:text-rose-400',
  tex: 'text-teal-600 dark:text-teal-400',
  image: 'text-violet-600 dark:text-violet-400',
  sheet: 'text-emerald-600 dark:text-emerald-400',
  media: 'text-fuchsia-600 dark:text-fuchsia-400',
  config: 'text-zinc-500 dark:text-zinc-400',
} as const;

type Tone = keyof typeof TONE;
interface IconSpec { icon: LucideIcon; tone: Tone }

const spec = (icon: LucideIcon, tone: Tone): IconSpec => ({ icon, tone });

const EXTENSION_ICONS: Record<string, IconSpec> = {
  js: spec(FileCode, 'code'), jsx: spec(FileCode, 'code'), mjs: spec(FileCode, 'code'), cjs: spec(FileCode, 'code'),
  ts: spec(FileCode2, 'code'), tsx: spec(FileCode2, 'code'), mts: spec(FileCode2, 'code'),
  vue: spec(FileCode2, 'code'), svelte: spec(FileCode2, 'code'),
  py: spec(Code2, 'python'), pyw: spec(Code2, 'python'), pyi: spec(Code2, 'python'), ipynb: spec(NotebookPen, 'python'),
  rs: spec(Cog, 'code'), go: spec(Hexagon, 'code'), rb: spec(Gem, 'code'), erb: spec(Gem, 'code'), php: spec(Blocks, 'code'),
  java: spec(Coffee, 'code'), jar: spec(Coffee, 'code'), kt: spec(Hexagon, 'code'), kts: spec(Hexagon, 'code'),
  c: spec(Cpu, 'code'), h: spec(Cpu, 'code'), cpp: spec(Cpu, 'code'), hpp: spec(Cpu, 'code'), cc: spec(Cpu, 'code'), cu: spec(Cpu, 'code'),
  cs: spec(Hexagon, 'code'), swift: spec(Flame, 'code'), lua: spec(SquareFunction, 'code'), r: spec(FlaskConical, 'code'),
  jl: spec(SquareFunction, 'code'), m: spec(SquareFunction, 'code'),
  html: spec(Globe, 'code'), htm: spec(Globe, 'code'), css: spec(Hash, 'code'), scss: spec(Hash, 'code'), sass: spec(Hash, 'code'), less: spec(Hash, 'code'),
  sh: spec(Terminal, 'config'), bash: spec(Terminal, 'config'), zsh: spec(Terminal, 'config'), fish: spec(Terminal, 'config'),
  ps1: spec(Terminal, 'config'), bat: spec(Terminal, 'config'), cmd: spec(Terminal, 'config'), slurm: spec(Terminal, 'config'),

  json: spec(Braces, 'data'), jsonc: spec(Braces, 'data'), json5: spec(Braces, 'data'), jsonl: spec(Braces, 'data'),
  yaml: spec(Settings, 'config'), yml: spec(Settings, 'config'), toml: spec(Settings, 'config'), ini: spec(Settings, 'config'),
  cfg: spec(Settings, 'config'), conf: spec(Settings, 'config'), env: spec(Shield, 'config'), lock: spec(Lock, 'config'),
  xml: spec(FileCode, 'data'), sql: spec(Database, 'data'), graphql: spec(Workflow, 'data'), gql: spec(Workflow, 'data'), proto: spec(Box, 'data'),
  npy: spec(Database, 'data'), npz: spec(Database, 'data'), pkl: spec(Database, 'data'), pickle: spec(Database, 'data'),
  pt: spec(Database, 'data'), pth: spec(Database, 'data'), ckpt: spec(Database, 'data'), safetensors: spec(Database, 'data'),
  h5: spec(Database, 'data'), hdf5: spec(Database, 'data'), parquet: spec(Database, 'data'), arrow: spec(Database, 'data'),
  csv: spec(FileSpreadsheet, 'sheet'), tsv: spec(FileSpreadsheet, 'sheet'), xlsx: spec(FileSpreadsheet, 'sheet'), xls: spec(FileSpreadsheet, 'sheet'),

  md: spec(BookOpen, 'doc'), mdx: spec(BookOpen, 'doc'), txt: spec(FileText, 'doc'), rst: spec(FileText, 'doc'),
  doc: spec(FileText, 'doc'), docx: spec(FileText, 'doc'), rtf: spec(FileText, 'doc'), log: spec(Scroll, 'doc'),
  pdf: spec(FileCheck, 'pdf'),
  tex: spec(Scroll, 'tex'), sty: spec(Scroll, 'tex'), cls: spec(Scroll, 'tex'), bst: spec(Scroll, 'tex'), bbl: spec(Scroll, 'tex'),
  bib: spec(BookMarked, 'tex'),
  ppt: spec(Presentation, 'media'), pptx: spec(Presentation, 'media'), key: spec(Presentation, 'media'),

  png: spec(Image, 'image'), jpg: spec(Image, 'image'), jpeg: spec(Image, 'image'), gif: spec(Image, 'image'),
  webp: spec(Image, 'image'), ico: spec(Image, 'image'), bmp: spec(Image, 'image'), tiff: spec(Image, 'image'),
  eps: spec(Image, 'image'), svg: spec(Palette, 'image'),
  mp3: spec(Music2, 'media'), wav: spec(Music2, 'media'), ogg: spec(Music2, 'media'), flac: spec(Music2, 'media'),
  aac: spec(Music2, 'media'), m4a: spec(Music2, 'media'),
  mp4: spec(Video, 'media'), mov: spec(Video, 'media'), avi: spec(Video, 'media'), webm: spec(Video, 'media'), mkv: spec(Video, 'media'),
  ttf: spec(FileType, 'neutral'), otf: spec(FileType, 'neutral'), woff: spec(FileType, 'neutral'), woff2: spec(FileType, 'neutral'), eot: spec(FileType, 'neutral'),
  zip: spec(Archive, 'neutral'), tar: spec(Archive, 'neutral'), gz: spec(Archive, 'neutral'), tgz: spec(Archive, 'neutral'),
  bz2: spec(Archive, 'neutral'), rar: spec(Archive, 'neutral'), '7z': spec(Archive, 'neutral'),
  exe: spec(Binary, 'neutral'), bin: spec(Binary, 'neutral'), dll: spec(Binary, 'neutral'), so: spec(Binary, 'neutral'),
  dylib: spec(Binary, 'neutral'), wasm: spec(Binary, 'neutral'),
};

const FILENAME_ICONS: Record<string, IconSpec> = {
  Dockerfile: spec(Box, 'config'), 'docker-compose.yml': spec(Box, 'config'), 'docker-compose.yaml': spec(Box, 'config'),
  '.dockerignore': spec(Box, 'config'), '.gitignore': spec(Settings, 'config'), '.gitmodules': spec(Settings, 'config'),
  '.gitattributes': spec(Settings, 'config'), '.editorconfig': spec(Settings, 'config'),
  'package.json': spec(Braces, 'data'), 'package-lock.json': spec(Lock, 'config'), 'yarn.lock': spec(Lock, 'config'),
  'pnpm-lock.yaml': spec(Lock, 'config'), 'Cargo.toml': spec(Cog, 'config'), Makefile: spec(Terminal, 'config'),
  'CMakeLists.txt': spec(Cog, 'config'), 'requirements.txt': spec(FileText, 'python'), 'pyproject.toml': spec(Settings, 'python'),
  'environment.yml': spec(Settings, 'python'), 'README.md': spec(BookOpen, 'doc'), 'CLAUDE.md': spec(BookOpen, 'doc'),
  'AGENTS.md': spec(BookOpen, 'doc'), 'SKILL.md': spec(BookOpen, 'doc'), LICENSE: spec(FileCheck, 'doc'),
  'LICENSE.md': spec(FileCheck, 'doc'), 'CHANGELOG.md': spec(Scroll, 'doc'),
};

export function getFileIcon(filename: string): { icon: LucideIcon; className: string } {
  let entry = FILENAME_ICONS[filename];
  if (!entry && filename.startsWith('.env')) entry = spec(Shield, 'config');
  if (!entry) {
    const dot = filename.lastIndexOf('.');
    const extension = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
    entry = EXTENSION_ICONS[extension];
  }
  const resolved = entry ?? spec(File, 'neutral');
  return { icon: resolved.icon, className: TONE[resolved.tone] };
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

export function isImageFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}
