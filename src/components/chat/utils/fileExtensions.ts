export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus']);
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'flv', 'avi']);
export const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);
export const HTML_EXTENSIONS = new Set(['html', 'htm']);
export const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'cs', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'css', 'scss', 'less',
  'sql', 'yaml', 'yml', 'toml', 'xml',
]);

export function getFileExtension(nameOrPath: string): string {
  return nameOrPath.includes('.') ? (nameOrPath.split('.').pop()?.toLowerCase() || '') : '';
}
