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

/* ---------- LRU blob cache with automatic eviction (#1) ---------- */
const MAX_BLOB_CACHE_SIZE = 50;
const blobCache = new Map<string, string>();

function cacheBlobUrl(key: string, url: string): void {
  // Re-insert so Map iteration order reflects recency
  if (blobCache.has(key)) {
    const old = blobCache.get(key)!;
    blobCache.delete(key);
    if (old !== url) URL.revokeObjectURL(old);
  }
  blobCache.set(key, url);

  // Evict oldest entries when over limit
  while (blobCache.size > MAX_BLOB_CACHE_SIZE) {
    const oldest = blobCache.keys().next().value;
    if (oldest === undefined) break;
    const oldUrl = blobCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    blobCache.delete(oldest);
  }
}

/* ---------- Shared IntersectionObserver (#6) ---------- */
type ObserverCallback = (isIntersecting: boolean) => void;
const observerCallbacks = new Map<Element, ObserverCallback>();
let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = observerCallbacks.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { rootMargin: '100px' },
    );
  }
  return sharedObserver;
}

function observeElement(el: Element, callback: ObserverCallback): () => void {
  observerCallbacks.set(el, callback);
  getSharedObserver().observe(el);
  return () => {
    observerCallbacks.delete(el);
    getSharedObserver().unobserve(el);
  };
}

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

    let unobserved = false;
    const unobserve = observeElement(el, (isIntersecting) => {
      if (!isIntersecting || unobserved) return;
      unobserved = true;
      // Eagerly stop watching once visible
      getSharedObserver().unobserve(el);

      api.getFileContentBlob(projectName, absolutePath)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          cacheBlobUrl(absolutePath, url);
          setBlobUrl(url);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    });

    return () => { cancelled = true; unobserve(); };
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
  else if (CODE_EXTENSIONS.has(ext)) { icon = <FileCode2 className={iconClass} />; label = ext.toUpperCase().slice(0, 4); }
  else { icon = <File className={iconClass} />; }

  return (
    <div className={`${base} flex-col gap-0`}>
      {icon}
      {label && <span className="mt-px text-[7px] font-semibold leading-none text-muted-foreground">{label}</span>}
    </div>
  );
}
