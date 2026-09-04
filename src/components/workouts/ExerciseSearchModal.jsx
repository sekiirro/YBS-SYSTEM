import React, { useState, useEffect, useMemo } from 'react';
import { ExercisesService } from '@/services/exercises';
import { Modal, Badge } from '@/components/ui';
import { Search, Dumbbell, Video, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { id: 'all', label: 'All', labelAr: 'الكل' },
  { id: 'chest', label: 'Chest', labelAr: 'صدر' },
  { id: 'back', label: 'Back', labelAr: 'ظهر' },
  { id: 'legs', label: 'Legs', labelAr: 'أرجل' },
  { id: 'shoulders', label: 'Shoulders', labelAr: 'أكتاف' },
  { id: 'arms', label: 'Arms', labelAr: 'ذراعين' },
  { id: 'core', label: 'Core', labelAr: 'بطن وجذع' },
  { id: 'cardio', label: 'Cardio', labelAr: 'كارديو' },
  { id: 'full_body', label: 'Full Body', labelAr: 'جسم كامل' },
];

export default function ExerciseSearchModal({ open, onClose, onSelectExercise, workspaceId }) {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Custom exercise quick-add state
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState('chest');
  const [customEquipment, setCustomEquipment] = useState('Barbell');

  useEffect(() => {
    if (open) {
      loadExercises();
      setSearch('');
      setSelectedCategory('all');
      setShowCustomForm(false);
    }
  }, [open]);

  const loadExercises = async () => {
    try {
      setLoading(true);
      const data = await ExercisesService.list(workspaceId || undefined);
      setExercises(data || []);
    } catch (err) {
      console.error('Failed to load exercises:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredExercises = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exercises.filter((ex) => {
      const matchCat = selectedCategory === 'all' || ex.category === selectedCategory;
      const matchQuery =
        !q ||
        ex.name?.toLowerCase().includes(q) ||
        ex.muscle_group?.toLowerCase().includes(q) ||
        ex.equipment?.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [exercises, search, selectedCategory]);

  const handleSelect = (exercise) => {
    onSelectExercise({
      exercise_id: exercise.id,
      exercise_name: exercise.name,
      category: exercise.category || 'other',
      muscle_group: exercise.muscle_group || null,
      equipment: exercise.equipment || null,
      video_url: exercise.video_url || null,
      sets: 3,
      warmup_sets: 0,
      working_sets: 3,
      rep_range: '8-12',
      rest_seconds: 90,
      rpe: 8,
      warmup: false,
      notes: '',
    });
    onClose();
  };

  const handleAddCustom = () => {
    if (!customName.trim()) return;
    onSelectExercise({
      exercise_id: null,
      exercise_name: customName.trim(),
      category: customCategory,
      muscle_group: customCategory,
      equipment: customEquipment,
      video_url: null,
      sets: 3,
      warmup_sets: 0,
      working_sets: 3,
      rep_range: '8-12',
      rest_seconds: 90,
      rpe: 8,
      warmup: false,
      notes: '',
    });
    setCustomName('');
    setShowCustomForm(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Select Exercise from Library" size="lg">
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by exercise name, muscle, or equipment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-xl bg-secondary/60 border border-border text-[13px] focus:outline-none focus:border-primary/50 text-foreground"
            autoFocus
          />
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all',
                selectedCategory === cat.id
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary/80'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Exercises List */}
        <div className="max-h-80 overflow-y-auto divide-y divide-border/40 border border-border rounded-xl p-1 bg-secondary/10">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading exercise library…</div>
          ) : filteredExercises.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <Dumbbell className="w-8 h-8 mx-auto text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No exercises found matching your search.</p>
              {!showCustomForm && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomName(search);
                    setShowCustomForm(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add as custom exercise
                </button>
              )}
            </div>
          ) : (
            filteredExercises.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => handleSelect(ex)}
                className="w-full text-left p-3 rounded-lg hover:bg-secondary/60 flex items-center justify-between transition-colors group"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {ex.name}
                    </span>
                    {ex.video_url && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                        <Video className="w-2.5 h-2.5" /> Video
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge className="text-[10px] uppercase font-mono capitalize py-0 px-1.5">
                      {ex.category || 'general'}
                    </Badge>
                    {ex.equipment && <span>• {ex.equipment}</span>}
                    {ex.muscle_group && <span>• {ex.muscle_group}</span>}
                  </div>
                </div>

                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-primary font-medium">
                  <span>Add</span>
                  <Plus className="w-4 h-4" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Quick Custom Exercise Entry */}
        {showCustomForm ? (
          <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-primary" /> Create Custom Exercise
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Exercise Name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-secondary/80 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground sm:col-span-1"
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-secondary/80 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
              >
                {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Equipment (e.g. Dumbbell)"
                value={customEquipment}
                onChange={(e) => setCustomEquipment(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-secondary/80 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCustomForm(false)}
                className="px-3 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCustom}
                disabled={!customName.trim()}
                className="px-3 py-1 rounded-lg text-xs bg-primary text-primary-foreground font-medium disabled:opacity-50"
              >
                Add Custom Exercise
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center pt-2 text-xs text-muted-foreground">
            <span>Can't find an exercise?</span>
            <button
              type="button"
              onClick={() => setShowCustomForm(true)}
              className="text-primary hover:underline font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Custom Exercise
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
