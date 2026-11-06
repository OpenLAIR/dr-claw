import { cn } from '../../lib/utils';
import { splitNameForTruncation } from './fileTreeModel';

/**
 * One-line file name that loses characters from the middle when space runs
 * out, keeping the extension and the distinguishing end of the name visible.
 */
export default function MiddleTruncatedName({ name, className }: { name: string; className?: string }) {
  const { head, tail } = splitNameForTruncation(name);
  return (
    <span className={cn('flex min-w-0 flex-1 items-baseline', className)}>
      <span className="min-w-0 truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}
