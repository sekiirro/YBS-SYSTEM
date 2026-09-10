import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useAutosave — reusable server-persistent autosave hook.
 *
 * One abstraction shared by every editable workflow in the app (nutrition
 * drafts, workout plans, form templates, client form responses, packages).
 * Supabase is the source of truth: autosave calls the caller's `save`
 * function (an update/upsert against the existing entity id), so nothing is
 * ever re-created and nothing is ever auto-published/activated/submitted.
 *
 * Behaviour:
 *   - Debounces saves (default 1200ms) so there is no request per keystroke.
 *   - `snapshot` is a serialized string ONLY used for change detection; the
 *     caller's `save` reads the live component state when it runs.
 *   - `lastSavedSnapshot` is the serialized state as loaded/saved on the
 *     server. It establishes the baseline (so a freshly loaded entity does
 *     not trigger a spurious save) and is advanced internally after success.
 *   - `enabled` gates saving (e.g. drafts only, not-yet-submitted only) and
 *     `id` gates it per entity (null => disabled, preserving the explicit
 *     first-save/assign/create flows).
 *   - No overlapping saves: a hard in-flight lock ensures a second save is
 *     queued and runs only after the current one settles.
 *   - On failure the unsaved state stays in memory (dirty stays true),
 *     `status` becomes 'error', and a limited automatic retry is scheduled.
 *   - `flush()` persists pending changes immediately and is awaitable, so
 *     callers can drain before navigating / activating / submitting.
 *   - A `beforeunload` guard warns when unsaved changes exist.
 *
 * @returns {{ status: 'idle'|'saving'|'saved'|'error', dirty: boolean,
 *             error: string|null, flush: () => Promise<boolean>,
 *             reset: () => void }}
 */
export default function useAutosave({
  id,
  enabled = true,
  debounceMs = 1200,
  snapshot,
  lastSavedSnapshot,
  save,
  onSaved = undefined,
  onError = undefined,
}) {
  const [status, setStatus] = useState(/** @type {'idle' | 'saving' | 'saved' | 'error'} */ ('idle'));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const savedFlashTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const retryCountRef = useRef(0);

  const idRef = useRef(id);
  const enabledRef = useRef(enabled);
  const snapshotRef = useRef(snapshot);
  const lastSavedRef = useRef(lastSavedSnapshot ?? null);
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);

  useEffect(() => { idRef.current = id; });
  useEffect(() => { enabledRef.current = enabled; });
  useEffect(() => { saveRef.current = save; });
  useEffect(() => { onSavedRef.current = onSaved; });
  useEffect(() => { onErrorRef.current = onError; });

  const clearTimers = useCallback(() => {
    clearTimeout(timerRef.current);
    clearTimeout(retryTimerRef.current);
    clearTimeout(savedFlashTimerRef.current);
  }, []);

  const doSave = useCallback(async () => {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return false;
    }
    if (!idRef.current || !enabledRef.current) return false;

    const target = snapshotRef.current;
    if (!target || target === lastSavedRef.current) return false;

    inFlightRef.current = true;
    setStatus('saving');
    setError(null);
    try {
      const result = await saveRef.current();
      lastSavedRef.current = target;
      retryCountRef.current = 0;
      setDirty(false);
      setStatus('saved');
      clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = setTimeout(
        () => setStatus((s) => (s === 'saved' ? 'idle' : s)),
        2200
      );
      onSavedRef.current?.(result);
      return true;
    } catch (err) {
      const message = err?.message || 'Failed to save changes';
      setStatus('error');
      setError(message);
      onErrorRef.current?.(err);
      // Keep the unsaved state in memory (dirty) and retry a limited number
      // of times in the background.
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => { void doSave(); }, 4000);
      }
      return false;
    } finally {
      inFlightRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { void doSave(); }, debounceMs);
      }
    }
  }, [debounceMs]);

  // Change detection: schedule a debounced save whenever the snapshot string
  // moves away from the last-persisted string.
  useEffect(() => {
    snapshotRef.current = snapshot;

    if (!enabled || id == null) {
      clearTimers();
      inFlightRef.current = false;
      setDirty(false);
      return undefined;
    }

    if (snapshot == null || snapshot === lastSavedRef.current) {
      setDirty(false);
      return () => clearTimeout(timerRef.current);
    }

    setDirty(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void doSave(); }, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [snapshot, id, enabled, debounceMs, clearTimers, doSave]);

  // Re-baseline when a freshly loaded server snapshot arrives (initial load
  // or an external refresh); cancels any pending save that equals it.
  useEffect(() => {
    if (lastSavedSnapshot == null) return;
    lastSavedRef.current = lastSavedSnapshot;
    if (snapshotRef.current != null && snapshotRef.current === lastSavedSnapshot) {
      clearTimeout(timerRef.current);
      clearTimeout(retryTimerRef.current);
      retryCountRef.current = 0;
      setDirty(false);
    }
  }, [lastSavedSnapshot]);

  // Warn before refresh/close if there is unsaved or in-flight work.
  useEffect(() => {
    const handler = (e) => {
      if (!enabledRef.current || !idRef.current) return;
      if (dirty || status === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, status]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (inFlightRef.current) {
      return new Promise((resolve) => {
        const wait = setInterval(() => {
          if (!inFlightRef.current) {
            clearInterval(wait);
            void doSave().then((ok) => resolve(ok));
          }
        }, 60);
      });
    }
    return doSave();
  }, [clearTimers, doSave]);

  const reset = useCallback(() => {
    clearTimers();
    lastSavedRef.current = snapshotRef.current;
    retryCountRef.current = 0;
    setDirty(false);
    setStatus('idle');
    setError(null);
  }, [clearTimers]);

  return useMemo(
    () => ({ status, dirty, error, flush, reset }),
    [status, dirty, error, flush, reset]
  );
}