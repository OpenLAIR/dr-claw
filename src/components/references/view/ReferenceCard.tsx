import { useTranslation } from 'react-i18next';
import { FileText, Link2, Unlink, MessageSquare, Trash2 } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { Reference } from '../types';
import { formatAuthors } from '../types';

interface ReferenceCardProps {
  reference: Reference;
  isSelected?: boolean;
  isLinked?: boolean;
  isChecked?: boolean;
  onSelect?: (ref: Reference) => void;
  onToggleCheck?: (ref: Reference) => void;
  onLink?: (ref: Reference) => void;
  onUnlink?: (ref: Reference) => void;
  onChat?: (ref: Reference) => void;
  onDelete?: (ref: Reference) => void;
}

export default function ReferenceCard({
  reference,
  isSelected = false,
  isLinked = false,
  isChecked = false,
  onSelect,
  onToggleCheck,
  onLink,
  onUnlink,
  onChat,
  onDelete,
}: ReferenceCardProps) {
  const { t } = useTranslation('references');
  const authorsStr = formatAuthors(reference.authors);

  return (
    <div
      className={cn(
        'group relative rounded-lg border px-4 py-3 transition-colors cursor-pointer',
        isSelected
          ? 'border-primary/60 bg-primary/8'
          : 'border-border/40 bg-background hover:border-border/60 hover:bg-muted/40',
      )}
      onClick={() => onSelect?.(reference)}
    >
      <div className="flex items-start justify-between gap-3">
        {onToggleCheck && (
          <input
            type="checkbox"
            aria-label={reference.title}
            checked={isChecked}
            onChange={(e) => { e.stopPropagation(); onToggleCheck(reference); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-primary"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" className="min-w-0 break-words text-left text-sm font-medium text-foreground">{reference.title}</button>
          </div>
          {authorsStr && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{authorsStr}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {reference.year && (
              <Badge variant="secondary" className="text-xs">{reference.year}</Badge>
            )}
            {reference.journal && (
              <Badge variant="outline" className="max-w-[180px] truncate text-xs">{reference.journal}</Badge>
            )}
            {reference.source && (
              <Badge variant="outline" className="text-xs capitalize">{reference.source}</Badge>
            )}
            {reference.pdf_cached ? (
              <Badge variant="secondary" className="text-xs">PDF</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1 flex-wrap">
          {onChat && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={t('actions.chatAbout')}
              onClick={(e) => { e.stopPropagation(); onChat(reference); }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          {isLinked && onUnlink ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={t('actions.unlinkFromProject')}
              onClick={(e) => { e.stopPropagation(); onUnlink(reference); }}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          ) : onLink ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={t('actions.linkToProject')}
              onClick={(e) => { e.stopPropagation(); onLink(reference); }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label={t('actions.delete')}
              onClick={(e) => { e.stopPropagation(); onDelete(reference); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
