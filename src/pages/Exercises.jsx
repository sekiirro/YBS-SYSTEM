const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { Dumbbell, Plus, Search, ExternalLink, Edit, Archive } from 'lucide-react';

export default function Exercises() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exercises, setExercises] = useState([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const canManage = hasPermission(user, 'workout.exercise');

  useEffect(() => { loadExercises(); }, []);

  const loadExercises = async () => {
    try {
      setLoading(true);
      const data = await db.entities.Exercise.filter({ is_archived: false }, 'name', 500);
      setExercises(data);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return exercises.filter((e) => {
      if (search && !e.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      return true;
    });
  }, [exercises, search, catFilter]);

  if (loading) return <LoadingState label="Loading exercises…" />;

  return (
    <div>
      <PageHeader
        title="Exercise Library"
        description="Browse and manage exercises"
        icon={Dumbbell}
        actions={canManage && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Exercise</Button>}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search exercises…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40">
          <option value="all">All Categories</option>
          {['chest','back','shoulders','arms','legs','core','cardio','full_body','other'].map((c) => (
            <option key={c} value={c}>{c.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No exercises found" description="Add exercises to your library" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((e) => (
            <div key={e.id} className="surface-card p-4 hover:glow-subtle transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium truncate">{e.name}</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{e.category?.replace('_', ' ')}</p>
                </div>
                {e.video_url && (
                  <a href={e.video_url} target="_blank" rel="noopener noreferrer"
                    className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              {e.muscle_group && <p className="text-[12px] text-muted-foreground mt-2">{e.muscle_group}</p>}
              {e.equipment && <p className="text-[11px] text-muted-foreground mt-1">Equipment: {e.equipment}</p>}
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateExerciseModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadExercises(); }} />}
    </div>
  );
}

function CreateExerciseModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', video_url: '', category: 'chest', muscle_group: '', equipment: '', instructions: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      await db.entities.Exercise.create(form);
      onCreated();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add Exercise" size="lg">
      <div className="space-y-4">
        <Input label="Exercise Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Barbell Bench Press" />
        <Input label="Video / Resource URL" value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://youtube.com/…" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {['chest','back','shoulders','arms','legs','core','cardio','full_body','other'].map((c) => (
              <option key={c} value={c}>{c.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
            ))}
          </Select>
          <Input label="Muscle Group" value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} placeholder="Pectorals" />
        </div>
        <Input label="Equipment" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Barbell" />
        <TextArea label="Instructions" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Add Exercise'}</Button>
        </div>
      </div>
    </Modal>
  );
}