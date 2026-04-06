import { AlertTriangle, Monitor, X } from 'lucide-react';
import { Button } from '../ui/button';

interface ComputeWarningModalProps {
  isOpen: boolean;
  warnings: string[];
  runId?: string | null;
  onContinue: () => void;
  onCancel: () => void;
}

export default function ComputeWarningModal({
  isOpen,
  warnings,
  onContinue,
  onCancel,
}: ComputeWarningModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-label="Close warning"
      />

      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Compute Resources Unavailable</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                The experiment stage requires compute resources that may not be ready.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {warnings.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 space-y-2">
            {warnings.map((warning, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm text-amber-800 dark:text-amber-200">
                <Monitor className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Running experiments without adequate compute resources may cause failures,
          slow execution, or out-of-memory errors. You can continue anyway or cancel
          and configure compute resources first.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="outline"
            className="flex-1 rounded-xl"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
            onClick={onContinue}
          >
            Continue Anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
