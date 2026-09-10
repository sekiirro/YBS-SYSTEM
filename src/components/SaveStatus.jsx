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
      <Badge className="text-sky-400 bg-sky-500/10 border-sky-500/20 font-mono">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </Badge>
    );
  }

  if (status === 'saved') {
    return (
      <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-mono">
        <Check className="w-3 h-3" /> Saved
      </Badge>
    );
  }

  if (status === 'error' || (dirty && status === 'idle' && onRetry)) {
    return (
      <Badge className="text-red-400 bg-red-500/10 border-red-500/20 font-mono" variant="default">
        <AlertCircle className="w-3 h-3" /> Save failed
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-0.5 inline-flex items-center gap-1 text-red-300 hover:text-red-200 transition-colors"
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
      <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20 font-mono">
        <CloudUpload className="w-3 h-3" /> Unsaved changes
      </Badge>
    );
  }

  return null;
}