import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { ExercisesService } from '@/services/exercises';
import { WorkspacesService } from '@/services/workspaces';
import { isPlatformAdmin } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { Dumbbell, Plus, Search, ExternalLink, Edit, Archive, Building2 } from 'lucide-react';
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
  const [editingExercise, setEditingExercise] = useState(null);
  const [archivingId, setArchivingId] = useState(null);

  // Write access for the ACTIVE tab: platform owner, or the workspace
  // owner of the currently selected workspace. RLS enforces this server-side.
  const managedIds = (user?.managed_workspace_ids || []);
  const canManageActive = isPlatformAdmin(user) || (!!activeWs && managedIds.includes(activeWs.id));

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
      // Default tab: YBS when present, otherwise the first accessible workspace.
      const ybs = data.find((w) => w.slug === 'ybs-default') || data.find((w) => w.id === DEFAULT_WS_ID) || data[0];
      if (ybs) {
        setActiveWs(ybs);
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
        actions={canManageActive && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Exercise</Button>}
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
              {filtered.map((e) => (
                <div key={e.id} className="surface-card p-4 hover:glow-subtle transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-medium truncate">{e.name}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{e.category?.replace('_', ' ')}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {e.video_url && (
                        <a href={e.video_url} target="_blank" rel="noopener noreferrer"
                          className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      {canManageActive && (
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
                </div>
              ))}
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
    </div>
  );
}

function CreateExerciseModal({ workspaceId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', video_url: '', category: 'chest', muscle_group: '', equipment: '', instructions: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      await ExercisesService.create({ ...form, workspace_id: workspaceId });
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