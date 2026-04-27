import {
  ExternalLink,
  Star,
  Clock,
  ChevronDown,
  ChevronUp,
  Heart,
  Repeat2,
  MessageCircle,
  Bookmark,
  ArrowUp,
  FileText,
  GitFork,
  Download,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NewsSourceKey } from './useNewsDashboardData';

export type NewsItem = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  categories: string[];
  relevance_score: number;
  recency_score: number;
  popularity_score: number;
  quality_score: number;
  final_score: number;
  matched_domain: string;
  matched_keywords: string[];
  link?: string;
  pdf_link?: string;
  source?: string;
  // Social-specific fields
  engagement?: {
    likes?: number;
    retweets?: number;
    reposts?: number;
    replies?: number;
    comments?: number;
    collects?: number;
    impressions?: number;
    downloads?: number;
  };
  avatar_url?: string;
  media_urls?: string[];
  // HuggingFace-specific fields
  submitted_by?: string;
  organization?: string;
  // HF Hub repo extras (kind: papers | models | datasets | spaces)
  kind?: 'papers' | 'models' | 'datasets' | 'spaces' | string;
  pipeline_tag?: string;
  downloads?: number;
  hub_id?: string;
  // GitHub-specific extras
  stars?: number;
  forks?: number;
  language?: string;
  license?: string | null;
  owner_avatar?: string;
  mode?: string;
  // WeChat-specific extras
  account_name?: string;
  account_route?: string;
};

const LANGUAGE_COLORS: Record<string, string> = {
  python: 'bg-blue-500',
  typescript: 'bg-sky-500',
  javascript: 'bg-yellow-400',
  rust: 'bg-orange-600',
  go: 'bg-cyan-500',
  java: 'bg-red-500',
  'c++': 'bg-pink-500',
  cpp: 'bg-pink-500',
  c: 'bg-gray-500',
  ruby: 'bg-red-600',
  swift: 'bg-orange-500',
  kotlin: 'bg-purple-500',
  shell: 'bg-emerald-500',
  cuda: 'bg-green-600',
};

function langColor(lang?: string): string {
  if (!lang) return 'bg-muted';
  return LANGUAGE_COLORS[lang.toLowerCase()] || 'bg-muted-foreground/40';
}

function formatCompact(n?: number): string {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m3u8)(\?|$)/i;

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url) || url.includes('/video/');
}

function MediaPreview({ url, className }: { url: string; className?: string }) {
  if (isVideoUrl(url)) {
    return (
      <video
        src={url}
        className={className}
        controls
        muted
        preload="metadata"
        playsInline
      />
    );
  }
  return <img src={url} alt="" className={className} />;
}

function ScoreBar({ label, score, max = 3, barClass, dotClass }: { label: string; score: number; max?: number; barClass: string; dotClass: string }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="flex items-center gap-1.5 w-[5.5rem] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <div className="flex-1 h-[5px] bg-muted/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right font-medium tabular-nums text-foreground/70">{score.toFixed(1)}</span>
    </div>
  );
}

function EngagementBadges({ engagement }: { engagement: NewsItem['engagement'] }) {
  if (!engagement) return null;
  const items: { icon: typeof Heart; value: number; label: string }[] = [];
  if (engagement.likes != null) items.push({ icon: Heart, value: engagement.likes, label: 'likes' });
  if (engagement.retweets != null) items.push({ icon: Repeat2, value: engagement.retweets, label: 'retweets' });
  if (engagement.reposts != null) items.push({ icon: Repeat2, value: engagement.reposts, label: 'reposts' });
  if (engagement.comments != null) items.push({ icon: MessageCircle, value: engagement.comments, label: 'comments' });
  if (engagement.replies != null) items.push({ icon: MessageCircle, value: engagement.replies, label: 'replies' });
  if (engagement.collects != null) items.push({ icon: Bookmark, value: engagement.collects, label: 'collects' });
  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-3 mt-2">
      {items.map(({ icon: Icon, value, label }) => (
        <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Icon className="h-3 w-3" /> {value}
        </span>
      ))}
    </div>
  );
}

export default function NewsItemCard({ item, index, sourceKey }: { item: NewsItem; index: number; sourceKey: NewsSourceKey }) {
  const { t } = useTranslation('news');
  const [expanded, setExpanded] = useState(false);

  const isTopItem = index < 3;
  const borderAccent = isTopItem ? 'border-amber-200/80 dark:border-amber-800/50' : 'border-border/60';

  // Build links based on source
  const arxivId = item.id?.replace(/^https?:\/\/arxiv\.org\/abs\//, '') ?? '';
  const primaryUrl = item.link || (sourceKey === 'arxiv' ? `https://arxiv.org/abs/${arxivId}` : '#');
  const pdfUrl = item.pdf_link || (sourceKey === 'arxiv' ? `https://arxiv.org/pdf/${arxivId}` : null);

  const sourceBadgeLabel = sourceKey === 'arxiv' ? 'arXiv'
    : sourceKey === 'huggingface' ? 'HF'
    : sourceKey === 'github' ? 'GitHub'
    : sourceKey === 'wechat' ? '公众号'
    : sourceKey === 'x' ? 'X'
    : 'XHS';

  const SCORE_COLORS = [
    { label: t('card.relevance'), key: 'relevance_score' as const, bar: 'bg-gradient-to-r from-sky-400 to-sky-500', dot: 'bg-sky-500' },
    { label: t('card.recency'), key: 'recency_score' as const, bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500', dot: 'bg-emerald-500' },
    { label: t('card.popularity'), key: 'popularity_score' as const, bar: 'bg-gradient-to-r from-amber-400 to-amber-500', dot: 'bg-amber-500' },
    { label: t('card.quality'), key: 'quality_score' as const, bar: 'bg-gradient-to-r from-violet-400 to-violet-500', dot: 'bg-violet-500' },
  ];

  // XHS / X: compact card — cover image, title, abstract snippet, and link
  if (sourceKey === 'xiaohongshu' || sourceKey === 'x') {
    const coverUrl = item.media_urls?.[0];
    return (
      <article className={`group relative overflow-hidden rounded-[22px] border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
        <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="block">
          {coverUrl && (
            <MediaPreview url={coverUrl} className="w-full max-h-[260px] object-cover" />
          )}
          <div className="p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-snug text-foreground tracking-tight line-clamp-2 flex-1 min-w-0">{item.title}</h3>
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {sourceBadgeLabel} <ExternalLink className="h-2.5 w-2.5" />
              </span>
            </div>
            {item.abstract && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground/70 line-clamp-3 whitespace-pre-line">{item.abstract}</p>
            )}
            {item.authors && (
              <p className="mt-2 text-[11px] text-muted-foreground/60">@{item.authors}</p>
            )}
          </div>
        </a>
      </article>
    );
  }

  // WeChat 公众号: article card with account name, excerpt, link
  if (sourceKey === 'wechat') {
    const accountName = item.account_name || item.authors || '';
    return (
      <article className={`group relative overflow-hidden rounded-2xl border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
        <div className="p-4 flex flex-col gap-3 h-full">
          {/* Header: account chip + title + score */}
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex-shrink-0">
              <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            </span>
            <div className="flex-1 min-w-0">
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors line-clamp-2"
              >
                {item.title || t('card.untitled')}
              </a>
              {accountName && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{accountName}</p>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30 flex-shrink-0">
              <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
              <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">{item.final_score?.toFixed(1) ?? '—'}</span>
            </div>
          </div>

          {/* Excerpt */}
          {item.abstract && item.abstract !== '(no excerpt)' && (
            <p className="text-xs leading-relaxed text-muted-foreground/85 line-clamp-4">{item.abstract}</p>
          )}

          {/* Footer: published + open link */}
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
            {item.published && (
              <span className="tabular-nums">{item.published.slice(0, 10)}</span>
            )}
            <a
              href={primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('card.openInWechat')} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </article>
    );
  }

  // GitHub: repo card with stars, forks, language, topics
  if (sourceKey === 'github') {
    const stars = item.stars ?? item.engagement?.likes ?? 0;
    const forks = item.forks ?? item.engagement?.comments ?? 0;
    const isTrending = item.mode === 'trending';
    return (
      <article className={`group relative overflow-hidden rounded-2xl border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
        <div className="p-4 flex flex-col gap-3 h-full">
          {/* Header: avatar + repo name + score */}
          <div className="flex items-start gap-2.5">
            {item.owner_avatar ? (
              <img src={item.owner_avatar} alt="" className="h-8 w-8 rounded-lg object-cover border border-border/30 flex-shrink-0" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-950/40 flex-shrink-0">
                <FileText className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors line-clamp-2 break-all"
              >
                {item.title}
              </a>
              {item.authors && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.authors}</p>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30 flex-shrink-0">
              <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
              <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">{item.final_score?.toFixed(1) ?? '—'}</span>
            </div>
          </div>

          {/* Trending pill */}
          {isTrending && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
              <TrendingUp className="h-2.5 w-2.5" /> {t('card.trending')}
            </span>
          )}

          {/* Description */}
          {item.abstract && item.abstract !== '(no description)' && (
            <p className="text-xs leading-relaxed text-muted-foreground/85 line-clamp-3">{item.abstract}</p>
          )}

          {/* Topics */}
          {item.categories && item.categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.categories.slice(0, 4).map((topic) => (
                <span key={topic} className="rounded-md border border-violet-200/60 bg-violet-50/70 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-800/40 dark:bg-violet-950/30 dark:text-violet-300">
                  {topic}
                </span>
              ))}
            </div>
          )}

          {/* Footer: language + stars + forks + license */}
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
            {item.language && (
              <span className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${langColor(item.language)}`} />
                <span>{item.language}</span>
              </span>
            )}
            <span className="flex items-center gap-1 tabular-nums">
              <Star className="h-3 w-3" /> {formatCompact(stars)}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <GitFork className="h-3 w-3" /> {formatCompact(forks)}
            </span>
            {item.license && (
              <span className="flex items-center gap-1">
                <Scale className="h-3 w-3" /> {item.license}
              </span>
            )}
            <a
              href={primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </article>
    );
  }

  // HuggingFace: paper card OR Hub repo card depending on `kind`
  if (sourceKey === 'huggingface') {
    const isHubRepo = item.kind === 'models' || item.kind === 'datasets' || item.kind === 'spaces';
    const thumbnailUrl = item.media_urls?.[0];
    const upvotes = item.engagement?.likes ?? 0;
    const comments = item.engagement?.comments ?? 0;
    const downloads = item.downloads ?? item.engagement?.downloads ?? 0;

    // Hub repo card: compact layout with kind badge, pipeline tag, downloads
    if (isHubRepo) {
      const kindBadge: Record<string, { label: string; className: string }> = {
        models: { label: t('card.kindModel'), className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
        datasets: { label: t('card.kindDataset'), className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
        spaces: { label: t('card.kindSpace'), className: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300' },
      };
      const badge = kindBadge[item.kind as string];

      return (
        <article className={`group relative overflow-hidden rounded-2xl border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
          <div className="p-4 flex flex-col gap-3 h-full">
            <div className="flex items-start gap-2.5">
              <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                <ArrowUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold tabular-nums text-foreground">{formatCompact(upvotes)}</span>
              </div>
              <div className="flex-1 min-w-0">
                {badge && (
                  <span className={`inline-block mb-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
                <a
                  href={primaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors line-clamp-2 break-all"
                >
                  {item.title}
                </a>
                {item.organization && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.organization}</p>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30 flex-shrink-0">
                <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
                <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">{item.final_score?.toFixed(1) ?? '—'}</span>
              </div>
            </div>

            {item.abstract && item.abstract !== `${(item.kind ?? '').toString().replace(/^\w/, (c) => c.toUpperCase())} on Hugging Face Hub.` && (
              <p className="text-xs leading-relaxed text-muted-foreground/85 line-clamp-3">{item.abstract}</p>
            )}

            {item.categories && item.categories.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.pipeline_tag && (
                  <span className="rounded-md border border-yellow-200/70 bg-yellow-50 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700 dark:border-yellow-800/40 dark:bg-yellow-950/30 dark:text-yellow-300">
                    {item.pipeline_tag}
                  </span>
                )}
                {item.categories.filter((c) => c !== item.pipeline_tag).slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
              {downloads > 0 && (
                <span className="flex items-center gap-1 tabular-nums">
                  <Download className="h-3 w-3" /> {formatCompact(downloads)}
                </span>
              )}
              <span className="flex items-center gap-1 tabular-nums">
                <Heart className="h-3 w-3" /> {formatCompact(upvotes)}
              </span>
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                HF <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        </article>
      );
    }

    // Daily Paper card (original layout)
    return (
      <article className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        {/* Thumbnail */}
        <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="block">
          {thumbnailUrl ? (
            <div className="relative aspect-[16/9] overflow-hidden bg-muted/30">
              <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
              {item.submitted_by && (
                <div className="absolute bottom-2 right-2 rounded-lg bg-black/60 px-2 py-1 text-[10px] text-white backdrop-blur-sm">
                  {t('card.submittedBy', { name: item.submitted_by })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-800">
              <FileText className="h-10 w-10 text-muted-foreground/20" />
            </div>
          )}
        </a>

        {/* Content */}
        <div className="p-4">
          <div className="flex gap-3">
            {/* Upvote count */}
            <div className="flex flex-col items-center pt-0.5">
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold tabular-nums text-foreground">{upvotes}</span>
            </div>

            <div className="flex-1 min-w-0">
              {/* Title */}
              <a href={primaryUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors line-clamp-2">
                {item.title}
              </a>

              {/* Organization badge + stats */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.organization && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    {item.organization}
                  </span>
                )}
                {pdfUrl && (
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    <FileText className="h-3 w-3" /> {t('card.pdf')}
                  </a>
                )}
                {comments > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MessageCircle className="h-3 w-3" /> {comments}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={`group relative overflow-hidden rounded-[22px] border ${borderAccent} bg-card/85 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}>
      {isTopItem ? (
        <div className="h-[3px] bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />
      ) : (
        <div className="h-[2px] bg-gradient-to-r from-amber-500/40 via-orange-500/40 to-rose-500/40" />
      )}

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {item.avatar_url ? (
              <img src={item.avatar_url} alt="" className="h-8 w-8 rounded-xl object-cover" />
            ) : (
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold ${
                isTopItem
                  ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm'
                  : 'bg-muted/80 text-muted-foreground'
              }`}>
                {index + 1}
              </span>
            )}
            <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30">
              <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
              <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">{item.final_score?.toFixed(1) ?? '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <a href={primaryUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              {sourceBadgeLabel} <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                {t('card.pdf')} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* Title + cover thumbnail for social sources */}
        <div className="mt-3.5 flex gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug text-foreground tracking-tight">{item.title}</h3>
            <p className="mt-1.5 text-xs text-muted-foreground/80 line-clamp-1">{item.authors}</p>
            {item.abstract && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground/70 line-clamp-3">{item.abstract}</p>
            )}
            <EngagementBadges engagement={item.engagement} />
          </div>
          {item.media_urls && item.media_urls.length > 0 && (
            <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
              <img
                src={item.media_urls[0]}
                alt=""
                className="h-20 w-20 rounded-xl object-cover border border-border/30 sm:h-24 sm:w-24"
              />
            </a>
          )}
        </div>

        {/* Tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.matched_domain && (
            <span className="rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
              {item.matched_domain}
            </span>
          )}
          {item.categories?.slice(0, 3).map((cat) => (
            <span key={cat} className="rounded-lg border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {cat}
            </span>
          ))}
          {item.published && (
            <span className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {item.published.slice(0, 10)}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3.5 flex items-center gap-1.5 text-xs font-medium text-primary/80 hover:text-primary transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? t('card.showLess') : t('card.showMore')}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-3.5 space-y-4 rounded-xl bg-muted/20 p-4 border border-border/30">
            <p className="text-xs leading-[1.7] text-muted-foreground whitespace-pre-line">{item.abstract}</p>

            {/* Media images for social sources */}
            {item.media_urls && item.media_urls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {item.media_urls.slice(0, 4).map((url, i) => (
                  <img key={i} src={url} alt="" className="h-24 w-24 rounded-lg object-cover border border-border/30" />
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 mb-2">{t('card.scoreBreakdown')}</div>
              {SCORE_COLORS.map(({ label, key, bar, dot }) => (
                <ScoreBar key={key} label={label} score={item[key] ?? 0} barClass={bar} dotClass={dot} />
              ))}
            </div>

            {item.matched_keywords?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground/70 mr-0.5">{t('card.matchedKeywords')}</span>
                {item.matched_keywords.map((kw) => (
                  <span key={kw} className="rounded-md bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary/80 border border-primary/10">{kw}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
