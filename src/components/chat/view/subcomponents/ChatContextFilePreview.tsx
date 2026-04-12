import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ExternalLink, FileText, X } from 'lucide-react';

import { Button } from '../../../ui/button';
import { api } from '../../../../utils/api';
import type { SessionContextFileItem, SessionContextOutputItem } from '../../utils/sessionContextSummary';

export type PreviewFileTarget =
  | SessionContextFileItem
  | SessionContextOutputItem
  | {
      name?: string;
      relativePath: string;
      absolutePath?: string;
    };

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

type PreviewFile = PreviewFileTarget | null;

type PreviewKind = 'empty' | 'loading' | 'text' | 'markdown' | 'html' | 'pdf' | 'image' | 'audio' | 'video' | 'error';

const getPreviewKind = (file: PreviewFile): PreviewKind => {
  if (!file) {
    return 'empty';
  }

  const name = file.name || file.relativePath || '';
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';

  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  return 'text';
};

interface ChatContextFilePreviewProps {
  projectName: string;
  file: PreviewFile;
  onOpenInEditor?: (filePath: string) => void;
  onClose?: () => void;
  compact?: boolean;
  preloadedContent?: string | null;
}

export default function ChatContextFilePreview({
  projectName,
  file,
  onOpenInEditor,
  onClose,
  compact = false,
  preloadedContent = null,
}: ChatContextFilePreviewProps) {
  const { t } = useTranslation('chat');
  const [content, setContent] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const previewKind = useMemo(() => getPreviewKind(file), [file]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setContent('');
    setLoadError(null);
    setLoading(Boolean(file));
    setBlobUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });

    if (!file) {
      setLoading(false);
      return undefined;
    }

    if (typeof preloadedContent === 'string') {
      setContent(preloadedContent);
      setLoading(false);
      return undefined;
    }

    const loadPreview = async () => {
      try {
        if (previewKind === 'pdf' || previewKind === 'image' || previewKind === 'audio' || previewKind === 'video') {
          const absolutePath = file.absolutePath || file.relativePath;
          const blob = await api.getFileContentBlob(projectName, absolutePath);
          if (cancelled) {
            return;
          }

          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
          return;
        }

        const response = await api.readFile(projectName, file.relativePath);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const rawText = await response.text();
        if (cancelled) {
          return;
        }

        try {
          const parsed = JSON.parse(rawText);
          const nextContent = typeof parsed?.content === 'string'
            ? parsed.content
            : JSON.stringify(parsed?.content ?? parsed, null, 2);
          setContent(nextContent);
        } catch {
          setContent(rawText);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load preview.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file, preloadedContent, previewKind, projectName]);

  const openPath = file?.absolutePath || file?.relativePath || '';
  const emptyHeightClass = compact ? 'min-h-[180px]' : 'min-h-[240px]';
  const previewHeightClass = compact ? 'min-h-[220px]' : 'min-h-[320px]';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/80">
      <div className={`flex items-center justify-between gap-2 border-b border-border/60 ${compact ? 'px-2.5 py-2' : 'px-3 py-2'}`}>
        <div className="min-w-0">
          <div className={`${compact ? 'text-[13px]' : 'text-sm'} truncate font-medium text-foreground`}>
            {file?.name || t('sessionContext.preview.titleFallback')}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {file?.relativePath || t('sessionContext.preview.selectFile')}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {file && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenInEditor?.(openPath)}
              className={compact ? 'h-7 px-2 text-[11px]' : undefined}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t('sessionContext.preview.open')}
            </Button>
          )}
          {onClose && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 p-0"
              title={t('sessionContext.preview.closePreview')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className={`flex ${emptyHeightClass} flex-1 items-center justify-center text-sm text-muted-foreground`}>
          {t('sessionContext.preview.loading')}
        </div>
      )}

      {!loading && loadError && (
        <div className={`flex ${emptyHeightClass} flex-1 items-center justify-center px-4 text-center text-sm text-destructive`}>
          {t('sessionContext.preview.loadError', { error: loadError })}
        </div>
      )}

      {!loading && !loadError && previewKind === 'empty' && (
        <div className={`flex ${emptyHeightClass} flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground`}>
          <FileText className="h-7 w-7 opacity-60" />
          <div className="mt-3 text-sm font-medium text-foreground">{t('sessionContext.preview.selectToReview')}</div>
          <div className="mt-1 text-xs">
            {t('sessionContext.preview.unreadHint')}
          </div>
        </div>
      )}

      {!loading && !loadError && previewKind === 'pdf' && blobUrl && (
        <iframe title={file?.name || 'PDF preview'} src={blobUrl} className={`${previewHeightClass} flex-1 border-0`} />
      )}

      {!loading && !loadError && previewKind === 'image' && blobUrl && (
        <div className={`flex ${emptyHeightClass} flex-1 items-center justify-center overflow-auto bg-muted/10 p-3`}>
          <img src={blobUrl} alt={file?.name || 'Image preview'} className="max-h-full max-w-full rounded-lg border border-border/60" />
        </div>
      )}

      {!loading && !loadError && previewKind === 'audio' && blobUrl && (
        <div className={`flex ${emptyHeightClass} flex-1 items-center justify-center px-4`}>
          <audio src={blobUrl} controls className="w-full" />
        </div>
      )}

      {!loading && !loadError && previewKind === 'video' && blobUrl && (
        <div className={`flex ${emptyHeightClass} flex-1 items-center justify-center bg-black p-3`}>
          <video src={blobUrl} controls className="max-h-full w-full rounded-lg" />
        </div>
      )}

      {!loading && !loadError && previewKind === 'html' && (
        <div className={`${previewHeightClass} flex-1 overflow-auto bg-muted/10 p-3`}>
          <iframe
            title={file?.name || 'HTML preview'}
            srcDoc={content}
            sandbox="allow-scripts allow-same-origin"
            className={`h-full ${previewHeightClass} w-full rounded-xl border border-border/60 bg-white`}
          />
        </div>
      )}

      {!loading && !loadError && previewKind === 'markdown' && (
        <div className={`${previewHeightClass} flex-1 overflow-auto bg-muted/10 ${compact ? 'p-3' : 'p-4'}`}>
          <div className={`prose prose-sm max-w-none rounded-2xl border border-border/60 bg-background/90 shadow-sm dark:prose-invert ${compact ? 'p-4' : 'p-5'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {!loading && !loadError && previewKind === 'text' && (
        <pre className={`${previewHeightClass} flex-1 overflow-auto bg-background ${compact ? 'p-3 text-[11px]' : 'p-4 text-xs'} leading-6 text-foreground`}>
          {content}
        </pre>
      )}
    </div>
  );
}
