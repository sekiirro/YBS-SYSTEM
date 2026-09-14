import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { ExercisesService, isGlobalExercise } from '@/services/exercises';
import { WorkspacesService } from '@/services/workspaces';
import { isPlatformAdmin } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import ExerciseVersionLinkModal from '@/components/workouts/ExerciseVersionLinkModal';
import { Dumbbell, Plus, Search, ExternalLink, Edit, Archive, Building2, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_WS_ID = '00000000-0000-0000-0000-000000000001';

const CATEGORIES = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'full_body', 'other'];

function categoryLabel(c) {
  return c.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function Exercises() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showVersionLinks, setShowVersionLinks] = useState(false);
  const [editingExercise, setEditingExercise] = useState(null);
  const [archivingId, setArchivingId] = useState(null);

  // Write access for the ACTIVE tab: platform owner, or the workspace
  // owner of the currently selected workspace. RLS enforces this server-side.
  // YBS Global rows (workspace_id NULL) are read-only for everyone
  // except the platform owner — enforced per row below and by RLS.
  const managedIds = (user?.managed_workspace_ids || []);
  const canManageActive = isPlatformAdmin(user) || (!!activeWs && managedIds.includes(activeWs.id));
  const canManageExercise = (exercise) =>
    isPlatformAdmin(user) || (!isGlobalExercise(exercise) && canManageActive);

  useEffect(() => {
    loadWorkspaces();
  }, [user]);

  useEffect(() => {
    if (activeWs) loadExercises(activeWs.id);
  }, [activeWs]);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const data = await WorkspacesService.list();
      setWorkspaces(data);
      // Default tab: the user's active workspace when it is among the
      // accessible workspaces; otherwise preserve the safe fallback
      // (YBS Default, then the first accessible workspace).
      const activeDefault = user?.active_workspace_id
        ? data.find((w) => w.id === user.active_workspace_id)
        : null;
      const initialWs = activeDefault
        || data.find((w) => w.slug === 'ybs-default')
        || data.find((w) => w.id === DEFAULT_WS_ID)
        || data[0];
      if (initialWs) {
        setActiveWs(initialWs);
      } else {
        setActiveWs(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadExercises = async (wsId) => {
    try {
      setLoading(true);
      const data = await ExercisesService.list(wsId);
      setExercises(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (exercise) => {
    if (!window.confirm(`Archive "${exercise.name}"? It will no longer appear in the ${activeWs.name} exercise library.`)) return;
    try {
      setArchivingId(exercise.id);
      await ExercisesService.delete(exercise.id);
      await loadExercises(activeWs.id);
    } catch (err) {
      console.error(err);
    } finally {
      setArchivingId(null);
    }
  };

  const filtered = useMemo(() => {
    return exercises.filter((e) => {
      if (search && !e.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      return true;
    });
  }, [exercises, search, catFilter]);

  if (loading) return <LoadingState label="Loading exercise library…" />;

  return (
    <div>
      <PageHeader
        title="Exercise Library"
        description={activeWs ? `Workspace: ${activeWs.name}` : 'Select a workspace to view its exercise library'}
        icon={Dumbbell}
        actions={isPlatformAdmin(user) ? (
          <>
            <Button variant="secondary" onClick={() => setShowVersionLinks(true)}>
              <Link2 className="w-4 h-4" /> Link Versions
            </Button>
            {canManageActive && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Exercise</Button>}
          </>
        ) : (
          canManageActive && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Exercise</Button>
        )}
      />

      {workspaces.length === 0 ? (
        <EmptyState icon={Building2} title="No workspaces available" description="Your account has no workspace access yet." />
      ) : (
        <>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4 scrollbar-none border-b border-border/60">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setActiveWs(w)}
                className={cn(
                  'px-4 py-2 rounded-t-lg text-[13px] font-medium whitespace-nowrap transition-all border-b-2 -mb-px',
                  activeWs?.id === w.id
                    ? 'text-primary border-primary bg-primary/5 font-semibold'
                    : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-secondary/40'
                )}
              >
                {w.name}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={`Search ${activeWs?.name || ''} exercises…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              />
            </div>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
              className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40">
              <option value="all">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title="No exercises in this library yet"
              description={search || catFilter !== 'all' ? 'No exercises match your search.' : `Add exercises to the ${activeWs?.name || ''} library.`}
              action={canManageActive && !search && catFilter === 'all' ? <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Exercise</Button> : null}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((e) => {
                const isGlobal = isGlobalExercise(e);
                const canManageRow = canManageExercise(e);
                return (
                <div key={e.id} className="surface-card p-4 hover:glow-subtle transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-medium truncate flex items-center gap-1.5">
                        <span className="truncate">{e.name}</span>
                        {isGlobal && (
                          <span
                            className="inline-flex items-center shrink-0 text-[10px] font-semibold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30"
                            title="YBS Global Library — available in every workspace"
                          >
                            YBS
                          </span>
                        )}
                      </h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{e.category?.replace('_', ' ')}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {e.video_url && (
                        <a href={/^https?:\/\//i.test(e.video_url) ? e.video_url : `https://${e.video_url}`} target="_blank" rel="noopener noreferrer"
                          className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      {canManageRow && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingExercise(e)}
                            className="p-2 rounded-lg bg-secondary/60 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title={`Edit ${e.name}`}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchive(e)}
                            disabled={archivingId === e.id}
                            className="p-2 rounded-lg bg-secondary/60 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title={`Archive ${e.name}`}
                          >
                            <Archive className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {e.muscle_group && <p className="text-[12px] text-muted-foreground mt-2">{e.muscle_group}</p>}
                  {e.equipment && <p className="text-[11px] text-muted-foreground mt-1">Equipment: {e.equipment}</p>}
                  {isGlobal && <p className="text-[10px] text-amber-300/80 mt-1">YBS Global • available in every workspace</p>}
                </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateExerciseModal
          workspaceId={activeWs?.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadExercises(activeWs.id); }}
        />
      )}
      {editingExercise && (
        <EditExerciseModal
          exercise={editingExercise}
          onClose={() => setEditingExercise(null)}
          onUpdated={() => { setEditingExercise(null); loadExercises(activeWs.id); }}
        />
      )}
      {showVersionLinks && (
        <ExerciseVersionLinkModal
          open={showVersionLinks}
          onClose={() => setShowVersionLinks(false)}
        />
      )}
    </div>
  );
}

function CreateExerciseModal({ workspaceId, onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', video_url: '', category: 'chest', muscle_group: '', equipment: '', instructions: '' });
  const [makeGlobal, setMakeGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canCreateGlobal = isPlatformAdmin(user);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      // Global exercises (workspace_id NULL) are platform-owner only —
      // RLS rejects them for anyone else. Normal users always create
      // workspace-owned rows.
      await ExercisesService.create({ ...form, workspace_id: canCreateGlobal && makeGlobal ? null : workspaceId });
      onCreated();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to add exercise.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Exercise" size="lg">
      <div className="space-y-4">
        {canCreateGlobal && (
          <label className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-[12px] cursor-pointer">
            <input
              type="checkbox"
              checked={makeGlobal}
              onChange={(e) => setMakeGlobal(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-amber-300">YBS Global exercise</span>
              <span className="block text-muted-foreground mt-0.5">Available in every workspace. Only platform owners can create global exercises.</span>
            </span>
          </label>
        )}
        <Input label="Exercise Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Barbell Bench Press" />
        <Input label="Video / Resource URL" value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://youtube.com/…" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </Select>
          <Input label="Muscle Group" value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} placeholder="Pectorals" />
        </div>
        <Input label="Equipment" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Barbell" />
        <TextArea label="Instructions" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Add Exercise'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditExerciseModal({ exercise, onClose, onUpdated }) {
  const [form, setForm] = useState({
    name: exercise.name || '',
    video_url: exercise.video_url || '',
    category: exercise.category || 'chest',
    muscle_group: exercise.muscle_group || '',
    equipment: exercise.equipment || '',
    instructions: exercise.instructions || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      // Ownership is preserved: workspace ownership is never part of the
      // update payload; RLS prevents it from changing to another workspace.
      await ExercisesService.update(exercise.id, form);
      onUpdated();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to update exercise.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit Exercise — ${exercise.name}`} size="lg">
      <div className="space-y-4">
        {isGlobalExercise(exercise) && (
          <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 text-[12px] text-amber-300">
            YBS Global exercise — edits apply platform-wide. Only platform owners can edit.
          </div>
        )}
        <Input label="Exercise Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Video / Resource URL" value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://youtube.com/…" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </Select>
          <Input label="Muscle Group" value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} placeholder="Pectorals" />
        </div>
        <Input label="Equipment" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Barbell" />
        <TextArea label="Instructions" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}