import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_ICONS: Record<NewsSourceKey, { light: string; dark?: string }> = {
  arxiv: { light: '/icons/news/arxiv.svg' },
  huggingface: { light: '/icons/news/huggingface.svg' },
  github: { light: '/icons/news/github.svg', dark: '/icons/news/github-white.svg' },
  wechat: { light: '/icons/news/wechat.svg' },
  x: { light: '/icons/news/x-black.png', dark: '/icons/news/x-white.png' },
  xiaohongshu: { light: '/icons/news/xiaohongshu.png' },
};

/**
 * Renders the brand logo for a news source.
 * @param inverted - Force the dark/white variant (e.g. when on a colored active button background)
 */
export default function SourceIcon({ sourceKey, className, inverted }: { sourceKey: NewsSourceKey; className?: string; inverted?: boolean }) {
  const icon = SOURCE_ICONS[sourceKey];

  if (icon.dark) {
    if (inverted) {
      return <img src={icon.dark} alt="" className={className} />;
    }
    return (
      <>
        <img src={icon.light} alt="" className={`dark:hidden ${className ?? ''}`} />
        <img src={icon.dark} alt="" className={`hidden dark:block ${className ?? ''}`} />
      </>
    );
  }

  return <img src={icon.light} alt="" className={className} />;
}
