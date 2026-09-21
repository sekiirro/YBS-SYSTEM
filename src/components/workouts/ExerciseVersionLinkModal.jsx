import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button } from '@/components/ui';
import ExerciseSearchModal from '@/components/workouts/ExerciseSearchModal';
import { ExercisesService, isGlobalExercise } from '@/services/exercises';
import { WorkspacesService } from '@/services/workspaces';
import { ExerciseVersioningService } from '@/services/exerciseVersioning';
import {
  Link2, Unlink, Video, Globe, Building2, Check, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const GLOBAL_TAB = 'global';

/**
 * Platform-owner "Link exercise versions" manager.
 *
 * One canonical exercise = one logical movement. This modal maps concrete
 * exercise rows (per workspace + the YBS Global library) onto a canonical.
 * Workspace tabs appear automatically (new workspaces show "Not Linked").
 * Every persistence action goes through link_exercise_versions. Link scope:
 * a workspace-owned exercise may only be linked under its OWN workspace tab
 * (a KENDO video can never be linked as Drbahaa's version, and vice versa),
 * while a YBS Global exercise — the shared cross-workspace pool — may be
 * linked as the version for any workspace tab.
 */
export default function ExerciseVersionLinkModal({ open, onClose, initialSourceExerciseId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Loaded backing data.
  const [mappings, setMappings] = useState([]); // list_exercise_mappings rows
  const [workspaces, setWorkspaces] = useState([]);
  const [allExercises, setAllExercises] = useState([]);

  // Source exercise (the canonical root being edited).
  const [sourceExercise, setSourceExercise] = useState(null);
  const [sourceSearch, setSourceSearch] = useState('');
  const [showSourceSuggestions, setShowSourceSuggestions] = useState(false);

  // Canonical identity for the source.
  const [canonicalId, setCanonicalId] = useState(null);
  const [canonicalName, setCanonicalName] = useState('');

  // Active workspace tab + per-tab pending changes.
  const [activeTab, setActiveTab] = useState(GLOBAL_TAB);
  // { [tabKey]: { exercise } | { unlink: true } }
  const [pending, setPending] = useState({});

  const [pickerTarget, setPickerTarget] = useState(null); // tabKey | null
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaved(false);
    setPending({});
    setSourceExercise(null);
    setCanonicalId(null);
    setCanonicalName('');
    setActiveTab(GLOBAL_TAB);
    setSourceSearch('');
    setLoading(true);
    (async () => {
      try {
        const [m, ws, ex] = await Promise.all([
          ExerciseVersioningService.listMappings(),
          WorkspacesService.list(),
          ExercisesService.list(),
        ]);
        setMappings(m || []);
        setWorkspaces((ws || []).filter((w) => w.status === 'active'));
        setAllExercises(ex || []);

        if (initialSourceExerciseId) {
          const seed =
            (ex || []).find((e) => e.id === initialSourceExerciseId) ||
            await ExercisesService.getById(initialSourceExerciseId).catch(() => null);
          if (seed) {
            setSourceExercise(seed);
            const row = (m || []).find((r) => r.exercise_id === seed.id);
            setCanonicalId(row?.canonical_id || null);
            setCanonicalName(row?.canonical_name || seed.name);
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to load exercise linking data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, initialSourceExerciseId]);

  const tabs = useMemo(() => [
    { key: GLOBAL_TAB, label: 'YBS Global' },
    ...workspaces.map((w) => ({ key: w.id, label: w.name })),
  ], [workspaces]);

  const canonicalRows = useMemo(() => {
    return mappings.filter((r) => r.canonical_id === canonicalId);
  }, [mappings, canonicalId]);

  const linkedByTab = useMemo(() => {
    const map = {};
    for (const r of canonicalRows) {
      const key = r.workspace_id ?? GLOBAL_TAB;
      if (!map[key]) map[key] = r;
    }
    return map;
  }, [canonicalRows]);

  const canonicalNameOf = (id) => mappings.find((r) => r.canonical_id === id)?.canonical_name || '';

  const filteredSources = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return allExercises.slice(0, 8);
    return allExercises
      .filter((e) => e.name?.toLowerCase().includes(q) || e.muscle_group?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allExercises, sourceSearch]);

  const applySourceExercise = (ex) => {
    if (!ex) return;
    setSourceExercise(ex);
    setSourceSearch('');
    setShowSourceSuggestions(false);
    setPending({});
    setSaved(false);
    const row = mappings.find((r) => r.exercise_id === ex.id);
    setCanonicalId(row?.canonical_id || null);
    setCanonicalName(row?.canonical_name || ex.name);
  };

  const openPickerFor = (tabKey) => {
    setPickerTarget(tabKey);
  };

  const handlePickerSelect = (exercise) => {
    if (pickerTarget) {
      setPending((prev) => ({ ...prev, [pickerTarget]: { exercise } }));
    }
    setPickerTarget(null);
  };

  const handleUnlink = (tabKey) => {
    setPending((prev) => ({ ...prev, [tabKey]: { unlink: true } }));
  };

  const handleClearPending = (tabKey) => {
    setPending((prev) => {
      const next = { ...prev };
      delete next[tabKey];
      return next;
    });
  };

  const handleSave = async () => {
    if (!sourceExercise) {
      setError('Select a source exercise first.');
      return;
    }
    const name = canonicalName.trim();
    if (!canonicalId && !name) {
      setError('Give this canonical exercise a name before saving.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const idOrName = canonicalId
        ? { canonical_exercise_id: canonicalId }
        : { canonical_name: name };

      const items = [];

      // Canonical rename (existing).
      if (canonicalId && name && name !== canonicalNameOf(canonicalId)) {
        items.push({ canonical_exercise_id: canonicalId, canonical_name: name });
      }

      // Self-link: the source exercise itself belongs to this canonical.
      items.push({
        ...idOrName,
        exercise_id: sourceExercise.id,
        workspace_id: sourceExercise.workspace_id,
      });

      // Per-tab pending links / unlinks.
      for (const [tabKey, change] of Object.entries(pending)) {
        const wsId = tabKey === GLOBAL_TAB ? null : tabKey;
        if (change.unlink) {
          items.push({ ...idOrName, workspace_id: wsId });
        } else if (change.exercise) {
          items.push({ ...idOrName, exercise_id: change.exercise.exercise_id, workspace_id: wsId });
        }
      }

      const result = await ExerciseVersioningService.linkVersions(items);
      const refreshed = await ExerciseVersioningService.listMappings();
      setMappings(refreshed || []);
      setPending({});
      // If we just created a canonical, discover its id from the refresh.
      const selfRow = (refreshed || []).find((r) => r.exercise_id === sourceExercise.id);
      if (canonicalId) {
        setCanonicalName(canonicalNameOf(canonicalId) || name);
      } else if (selfRow) {
        setCanonicalId(selfRow.canonical_id);
        setCanonicalName(selfRow.canonical_name);
      }
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save exercise links.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveFor = (tabKey) => {
    const change = pending[tabKey];
    if (change?.unlink) return { linked: false };
    if (change?.exercise) return { linked: true, name: change.exercise.exercise_name, videoUrl: change.exercise.video_url };
    const row = linkedByTab[tabKey];
    if (row) return { linked: true, name: row.exercise_name, videoUrl: row.video_url };
    return { linked: false };
  };

  return (
    <Modal open={open} onClose={onClose} title="Link Exercise Versions" size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-[12px] text-muted-foreground bg-secondary/30 border border-border/60 rounded-xl px-3 py-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
          <p>
            Link concrete exercise rows onto one canonical movement. Every workspace tab (plus the YBS Global
            library) carries its own version; anything left unlinked resolves to the YBS Global version — or, if
            none exists, the original template exercise.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
        )}
        {saved && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-center gap-2">
            <Check className="w-3.5 h-3.5" /> Exercise links saved.
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-xs text-muted-foreground">Loading exercise linking data…</div>
        ) : (
          <>
            {/* Source exercise selector */}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div className="space-y-1.5 relative">
                <label className="text-xs font-semibold text-foreground">Source exercise</label>
                {sourceExercise ? (
                  <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-lg bg-secondary/50 border border-border text-xs">
                    <span className="truncate font-medium text-foreground">{sourceExercise.name}</span>
                    {isGlobalExercise(sourceExercise) && (
                      <span className="text-[12px] font-semibold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 shrink-0">YBS</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSourceExercise(null)}
                      className="text-muted-foreground hover:text-foreground text-sm leading-none"
                      title="Change source"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Search exercises to select a source…"
                    value={sourceSearch}
                    onChange={(e) => { setSourceSearch(e.target.value); setShowSourceSuggestions(true); }}
                    onFocus={() => setShowSourceSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSourceSuggestions(false), 150)}
                    className="w-full h-9 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
                  />
                )}
                {!sourceExercise && showSourceSuggestions && (
                  <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto divide-y divide-border/40 border border-border rounded-lg bg-background shadow-xl">
                    {filteredSources.length === 0 ? (
                      <li className="p-3 text-xs text-muted-foreground">No matches.</li>
                    ) : filteredSources.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onMouseDown={() => applySourceExercise(e)}
                          className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between gap-2"
                        >
                          <span className="text-xs text-foreground font-medium">{e.name}</span>
                          <span className="text-[12px] text-muted-foreground uppercase font-mono shrink-0">
                            {isGlobalExercise(e) ? 'YBS Global' : e.workspace_id}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Canonical name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Canonical name</label>
                <input
                  type="text"
                  placeholder="Logical exercise name (shared across workspaces)"
                  value={canonicalName}
                  onChange={(e) => { setCanonicalName(e.target.value); setSaved(false); }}
                  className="w-full h-9 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
                />
              </div>
            </div>

            {!sourceExercise ? (
              <p className="pt-4 pb-2 text-xs text-muted-foreground text-center border border-dashed border-border/60 rounded-lg">
                Select a source exercise to manage its linked versions.
              </p>
            ) : (
              <>
                {/* Workspace tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none border-b border-border/60">
                  {tabs.map((tab) => {
                    const eff = effectiveFor(tab.key);
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5',
                          activeTab === tab.key
                            ? 'bg-secondary text-foreground border border-border'
                            : 'text-muted-foreground hover:text-foreground border border-transparent'
                        )}
                      >
                        {tab.key === GLOBAL_TAB ? <Globe className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                        {tab.label}
                        <span className={cn(
                          'text-[12px] font-mono px-1 py-0.5 rounded',
                          eff.linked
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                        )}>
                          {eff.linked ? 'Linked' : 'Not Linked'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Active tab detail */}
                <div className="rounded-xl border border-border/80 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-foreground">
                      {activeTab === GLOBAL_TAB ? 'YBS Global Library' : `Version for ${activeTab === GLOBAL_TAB ? '' : tabs.find((t) => t.key === activeTab)?.label || activeTab}`}
                    </span>
                  </div>

                  {(() => {
                    const eff = effectiveFor(activeTab);
                    if (eff.linked) {
                      return (
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5 text-xs">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{eff.name}</p>
                            {eff.videoUrl && (
                              <span className="inline-flex items-center gap-1 text-[12px] text-primary mt-0.5">
                                <Video className="w-2.5 h-2.5" /> Video
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button size="sm" variant="ghost" className="text-xs" onClick={() => openPickerFor(activeTab)}>
                              Change
                            </Button>
                            <button
                              type="button"
                              onClick={() => handleUnlink(activeTab)}
                              className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                              title="Unlink this version"
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-500/5 border border-amber-500/25 px-3 py-2.5 text-xs">
                        <span className="text-amber-300 font-medium">Not Linked</span>
                        <Button size="sm" variant="secondary" className="text-xs" onClick={() => openPickerFor(activeTab)}>
                          <Link2 className="w-3 h-3" /> Choose Version
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving || !sourceExercise}>
            {saving ? 'Saving…' : 'Save Links'}
          </Button>
        </div>
      </div>

      <ExerciseSearchModal
        open={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        onSelectExercise={handlePickerSelect}
        workspaceId={pickerTarget === GLOBAL_TAB ? undefined : pickerTarget || undefined}
        globalOnly={pickerTarget === GLOBAL_TAB}
        title={pickerTarget === GLOBAL_TAB ? 'Select the YBS Global Version' : 'Select the Version for this Workspace'}
        confirmLabel="Choose"
      />
    </Modal>
  );
}