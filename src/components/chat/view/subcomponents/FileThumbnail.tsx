import { useEffect, useRef, useState } from 'react';
import { Braces, File, FileCode2, FileText, Film, Globe, Music } from 'lucide-react';

import { api } from '../../../../utils/api';
import {
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  HTML_EXTENSIONS,
  CODE_EXTENSIONS,
  getFileExtension,
} from '../../utils/fileExtensions';

const blobCache = new Map<string, string>();

interface FileThumbnailProps {
  projectName: string;
  absolutePath: string;
  fileName: string;
  className?: string;
}

export default function FileThumbnail({ projectName, absolutePath, fileName, className = '' }: FileThumbnailProps) {
  const ext = getFileExtension(fileName || absolutePath);
  const isImage = IMAGE_EXTENSIONS.has(ext);

  const [blobUrl, setBlobUrl] = useState<string | null>(() => (isImage ? blobCache.get(absolutePath) ?? null : null));
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isImage || blobUrl || failed) return undefined;

    let cancelled = false;
    const el = containerRef.current;
    if (!el) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        api.getFileContentBlob(projectName, absolutePath)
          .then((blob) => {
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            blobCache.set(absolutePath, url);
            setBlobUrl(url);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: '100px' },
    );

    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [absolutePath, blobUrl, failed, isImage, projectName]);

  const base = `flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/20 ${className}`;

  if (isImage && blobUrl) {
    return (
      <div ref={containerRef} className={base}>
        <img src={blobUrl} alt={fileName} className="h-full w-full object-cover" />
      </div>
    );
  }

  if (isImage) {
    return <div ref={containerRef} className={`${base} animate-pulse`} />;
  }

  const iconClass = 'h-3.5 w-3.5 text-muted-foreground';

  let icon;
  let label: string | undefined;

  if (ext === 'pdf') { icon = <FileText className={iconClass} />; label = 'PDF'; }
  else if (MARKDOWN_EXTENSIONS.has(ext) || ext === 'txt') { icon = <FileText className={iconClass} />; label = 'MD'; }
  else if (ext === 'json') { icon = <Braces className={iconClass} />; }
  else if (HTML_EXTENSIONS.has(ext)) { icon = <Globe className={iconClass} />; }
  else if (AUDIO_EXTENSIONS.has(ext)) { icon = <Music className={iconClass} />; }
  else if (VIDEO_EXTENSIONS.has(ext)) { icon = <Film className={iconClass} />; }
  else if (CODE_EXTENSIONS.has(ext)) { icon = <FileCode2 className={iconClass} />; label = ext.toUpperCase(); }
  else { icon = <File className={iconClass} />; }

  return (
    <div className={`${base} flex-col gap-0`}>
      {icon}
      {label && <span className="mt-px text-[7px] font-semibold leading-none text-muted-foreground">{label}</span>}
    </div>
  );
}
