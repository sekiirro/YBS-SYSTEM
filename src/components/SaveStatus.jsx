import { Badge } from '@/components/ui';
import { Loader2, Check, AlertCircle, CloudUpload, RefreshCw } from 'lucide-react';

/**
 * SaveStatus — tiny reusable indicator for server-persistent autosave state.
 * Renders nothing when fully idle (nothing unsaved, nothing running).
 *
 * Props come straight from the useAutosave hook:
 *   status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
 *   dirty:  boolean
 *   onRetry: optional () => void — triggers a manual retry (e.g. flush)
 */
export default function SaveStatus({ status, dirty, onRetry }) {
  if (status === 'saving') {
    return (
      <Badge className="text-[hsl(var(--nutri-info))] bg-[hsl(var(--nutri-info)/0.12)] border-[hsl(var(--nutri-info)/0.25)] font-mono">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </Badge>
    );
  }

  if (status === 'saved') {
    return (
      <Badge className="text-success bg-success/10 border-success/20 font-mono">
        <Check className="w-3 h-3" /> Saved
      </Badge>
    );
  }

  if (status === 'error') {
    return (
      <Badge className="text-destructive bg-destructive/10 border-destructive/20 font-mono" variant="default">
        <AlertCircle className="w-3 h-3" /> Save failed
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-0.5 inline-flex items-center gap-1 text-destructive/80 hover:text-destructive transition-colors"
            title="Retry save"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        )}
      </Badge>
    );
  }

  if (dirty) {
    return (
      <Badge className="text-warning bg-warning/10 border-warning/20 font-mono">
        <CloudUpload className="w-3 h-3" /> Unsaved changes
      </Badge>
    );
  }

  return null;
}