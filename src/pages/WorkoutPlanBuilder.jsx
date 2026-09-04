import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId } from '@/lib/ybs-auth';
import { WorkoutsService, calculateWorkoutVolume } from '@/services/workouts';
import { ClientsService } from '@/services/clients';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import ExerciseSearchModal from '@/components/workouts/ExerciseSearchModal';
import ExerciseVideoModal from '@/components/workouts/ExerciseVideoModal';
import {
  Dumbbell,
  ArrowLeft,
  Bookmark,
  Users,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Video,
  Flame,
  Info,
  Search,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const SPLIT_TYPES = [
  { id: 'full_body', label: 'Full Body', labelAr: 'تدريب كامل للجسم' },
  { id: 'upper_lower', label: 'Upper / Lower', labelAr: 'علوي / سفلي' },
  { id: 'push_pull_legs', label: 'Push / Pull / Legs (PPL)', labelAr: 'دفع / سحب / أرجل' },
  { id: 'arnold_split', label: 'Arnold Split', labelAr: 'تقسيم آرنولد' },
  { id: 'bro_split', label: 'Bro Split (Body Part)', labelAr: 'تقسيم العضلات المنفصلة' },
  { id: 'anterior_posterior', label: 'Anterior / Posterior', labelAr: 'أمامي / خلفي' },
  { id: 'torso_limbs', label: 'Torso / Limbs', labelAr: 'جذع / أطراف' },
  { id: 'push_pull', label: 'Push / Pull', labelAr: 'دفع / سحب' },
  { id: 'custom', label: 'Custom Split', labelAr: 'تقسيم مخصص' },
];

// ─── Split naming templates ──────────────────────────────────────
// Each entry defines a repeating cycle of session name prefixes.
// A letter suffix (A, B, C…) is appended per cycle iteration.
const SPLIT_SESSION_TEMPLATES = {
  upper_lower: ['Upper', 'Lower'],
  push_pull_legs: ['Push', 'Pull', 'Legs'],
  full_body: ['Full Body'],
  arnold_split: ['Chest & Back', 'Shoulders & Arms', 'Legs'],
  bro_split: ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms'],
  anterior_posterior: ['Anterior', 'Posterior'],
  torso_limbs: ['Torso', 'Limbs'],
  push_pull: ['Push', 'Pull'],
  custom: [],
};

/**
 * Generates the next intelligent session name for a given split type
 * based on existing sessions in the plan.
 *
 * @param {string} splitType - The split type id
 * @param {Array} existingDays - Current array of day objects
 * @param {string|null} customSplitName - Custom split title if applicable
 * @returns {string} The next session name
 */
export function generateSessionName(splitType, existingDays, customSplitName) {
  if (splitType === 'custom') {
    return existingDays.length > 0
      ? `Session ${existingDays.length + 1}`
      : customSplitName || 'Session 1';
  }

  const template = SPLIT_SESSION_TEMPLATES[splitType];
  if (!template || template.length === 0) {
    return `Day ${existingDays.length + 1}`;
  }

  const cycleLength = template.length;
  const nextIndex = existingDays.length;
  const cycleNumber = Math.floor(nextIndex / cycleLength);
  const positionInCycle = nextIndex % cycleLength;
  const prefix = template[positionInCycle];
  const suffix = String.fromCharCode(65 + cycleNumber); // A=65, B=66…

  return `${prefix} ${suffix}`;
}

/**
 * Returns the default initial days array for a given split type.
 */
function getDefaultDays(splitType, customSplitName) {
  const defaults = {
    upper_lower: ['Upper A', 'Lower A'],
    push_pull_legs: ['Push A', 'Pull A', 'Legs A'],
    full_body: ['Full Body A'],
    arnold_split: ['Chest & Back A', 'Shoulders & Arms A', 'Legs A'],
    bro_split: ['Chest A', 'Back A', 'Shoulders A', 'Legs A', 'Arms A'],
    anterior_posterior: ['Anterior A', 'Posterior A'],
    torso_limbs: ['Torso A', 'Limbs A'],
    push_pull: ['Push A', 'Pull A'],
    custom: [],
  };

  const names = defaults[splitType] || ['Day 1'];

  if (splitType === 'custom') {
    const initialName = customSplitName || 'Session 1';
    return [
      {
        id: `day-1-${Date.now()}`,
        day_name: initialName,
        sort_order: 0,
        rest_day: false,
        notes: '',
        exercises: [],
      },
    ];
  }

  return names.map((name, idx) => ({
    id: `day-${idx + 1}-${Date.now()}`,
    day_name: name,
    sort_order: idx,
    rest_day: false,
    notes: '',
    exercises: [],
  }));
}

export default function WorkoutPlanBuilder() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId');
  const queryClientId = searchParams.get('clientId');
  const navigate = useNavigate();
  const { user } = useAuth();
  const wsId = getActiveWorkspaceId(user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Plan Meta State
  const [planId, setPlanId] = useState(id || null);
  const [isTemplate, setIsTemplate] = useState(false);
  const [name, setName] = useState('');
  const [splitType, setSplitType] = useState('upper_lower');
  const [customSplitName, setCustomSplitName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  // Training Days State
  const [days, setDays] = useState([]);
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  // Modals
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [activeVideoExercise, setActiveVideoExercise] = useState(null);

  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState([]);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // ─── 1. Load Initial Plan / Template Data ───────────────────────────
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);

        const clientList = await ClientsService.list({});
        if (isMounted) setClients(clientList || []);

        if (id) {
          const plan = await WorkoutsService.getById(id);
          if (isMounted && plan) {
            setPlanId(plan.id);
            setName(plan.name || '');
            setSplitType(plan.split_type || 'upper_lower');
            setCustomSplitName(plan.custom_split_name || '');
            setNotes(plan.notes || '');
            setIsTemplate(!!plan.is_template);
            if (plan.client_id) {
              const matched = clientList.find((c) => c.id === plan.client_id);
              setSelectedClient(matched || { id: plan.client_id, full_name: plan.client_name });
            }
            // Normalize DB rows -> editor state. workout_exercises stores
            // total `sets`, `working_sets` and a row-level `warmup` flag; it
            // has NO warmup_sets column. Reconstruct the editor's warmup
            // count as max(0, sets - working_sets) — legacy rows were
            // backfilled by migration 12 into exactly that shape (warmup
            // only rows: working_sets = 0; normal rows: working_sets = sets).
            const migratedDays = (plan.days || []).map((d) => ({
              ...d,
              exercises: (d.exercises || []).map((ex) => {
                if (ex.warmup_sets !== undefined) return ex;
                const totalSets = Number(ex.sets) || 0;
                const workingSets = ex.working_sets !== undefined
                  ? Number(ex.working_sets) || 0
                  : (ex.warmup ? 0 : totalSets);
                const warmupSets = Math.max(0, totalSets - workingSets);
                return {
                  ...ex,
                  warmup_sets: warmupSets,
                  working_sets: workingSets,
                  sets: totalSets || 3,
                  warmup: warmupSets > 0 && workingSets === 0,
                };
              }),
            }));
            setDays(migratedDays);
          }
        } else if (templateId) {
          const tpl = await WorkoutsService.getById(templateId);
          if (isMounted && tpl) {
            setPlanId(null);
            setName(`${tpl.name} (Copy)`);
            setSplitType(tpl.split_type || 'upper_lower');
            setCustomSplitName(tpl.custom_split_name || '');
            setNotes(tpl.notes || '');
            setIsTemplate(false);

            const clonedDays = (tpl.days || []).map((d, dIdx) => ({
              id: `cloned-day-${dIdx}-${Date.now()}`,
              day_name: d.day_name,
              sort_order: dIdx,
              rest_day: !!d.rest_day,
              notes: d.notes || '',
              exercises: (d.exercises || []).map((ex, exIdx) => {
                const hasExplicitWarmup = ex.warmup_sets !== undefined;
                // DB rows carry working_sets (post-backfill): reconstruct the
                // warmup count from sets - working_sets. Pure legacy rows
                // (no working_sets column) derive from the warmup flag.
                const totalSets = Number(ex.sets) || 0;
                const workingSets = hasExplicitWarmup
                  ? Number(ex.working_sets) || 0
                  : (ex.working_sets !== undefined
                      ? Number(ex.working_sets) || 0
                      : (ex.warmup ? 0 : totalSets));
                const warmupSets = hasExplicitWarmup
                  ? Number(ex.warmup_sets) || 0
                  : Math.max(0, totalSets - workingSets);
                return {
                  id: `cloned-ex-${exIdx}-${Date.now()}`,
                  exercise_id: ex.exercise_id,
                  exercise_name: ex.exercise_name,
                  category: ex.category || 'other',
                  muscle_group: ex.muscle_group || null,
                  equipment: ex.equipment || null,
                  video_url: ex.video_url || null,
                  sort_order: exIdx,
                  warmup_sets: warmupSets,
                  working_sets: workingSets,
                  sets: warmupSets + workingSets || 3,
                  rep_range: ex.rep_range || '8-12',
                  rest_seconds: ex.rest_seconds || 90,
                  rpe: ex.rpe || 8,
                  warmup: warmupSets > 0 && workingSets === 0,
                  notes: ex.notes || '',
                };
              }),
            }));
            setDays(clonedDays);

            if (queryClientId) {
              const matched = clientList.find((c) => c.id === queryClientId);
              if (matched) setSelectedClient(matched);
            }
          }
        } else {
          setName('New Workout Program');
          setIsTemplate(searchParams.get('type') === 'template');
          setSplitType('upper_lower');
          setDays(getDefaultDays('upper_lower', ''));

          if (queryClientId) {
            const matched = clientList.find((c) => c.id === queryClientId);
            if (matched) setSelectedClient(matched);
          }
        }
      } catch (err) {
        console.error('Error loading workout builder data:', err);
        setError('Failed to load workout program data.');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [id, templateId, queryClientId]);

  // ─── 2. Live Volume Calculations ────────────────────────────────────
  const volumeData = useMemo(() => {
    return calculateWorkoutVolume(days);
  }, [days]);

  const activeDay = days[activeDayIndex] || days[0];

  // ─── 3. Days Management ─────────────────────────────────────────────
  const handleAddDay = () => {
    const newDayIndex = days.length;
    const sessionName = generateSessionName(splitType, days, customSplitName);
    const newDay = {
      id: `day-${newDayIndex + 1}-${Date.now()}`,
      day_name: sessionName,
      sort_order: newDayIndex,
      rest_day: false,
      notes: '',
      exercises: [],
    };
    setDays([...days, newDay]);
    setActiveDayIndex(newDayIndex);
  };

  const handleUpdateDay = (index, updates) => {
    setDays((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  };

  const handleDeleteDay = (index) => {
    if (days.length <= 1) {
      alert('A workout plan must have at least one session day.');
      return;
    }
    if (!window.confirm(`Delete ${days[index].day_name}?`)) return;
    setDays((prev) => prev.filter((_, idx) => idx !== index));
    setActiveDayIndex((prev) => Math.max(0, prev >= index ? prev - 1 : prev));
  };

  // ─── 4. Exercises Management ────────────────────────────────────────
  const handleAddExerciseToActiveDay = (exercisePayload) => {
    if (!activeDay) return;
    const exList = activeDay.exercises || [];
    const newExercise = {
      ...exercisePayload,
      id: `ex-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      sort_order: exList.length,
    };

    handleUpdateDay(activeDayIndex, {
      exercises: [...exList, newExercise],
    });
  };

  const handleUpdateExercise = (exerciseIndex, updates) => {
    if (!activeDay) return;
    const exList = [...(activeDay.exercises || [])];
    const prev = exList[exerciseIndex];
    const merged = { ...prev, ...updates };

    // Keep sets = warmup_sets + working_sets in sync
    if ('warmup_sets' in updates || 'working_sets' in updates) {
      const wu = Number(merged.warmup_sets) || 0;
      const ws = Number(merged.working_sets) || 0;
      merged.sets = wu + ws;
      // Row-level `warmup` flag = whole-exercise warm-up only (no working
      // sets), so volume consumers that shortcut on `warmup` stay correct
      // for exercises that mix warm-up + working sets.
      merged.warmup = wu > 0 && ws === 0;
    }

    exList[exerciseIndex] = merged;
    handleUpdateDay(activeDayIndex, { exercises: exList });
  };

  const handleDeleteExercise = (exerciseIndex) => {
    if (!activeDay) return;
    const exList = (activeDay.exercises || []).filter((_, idx) => idx !== exerciseIndex);
    handleUpdateDay(activeDayIndex, { exercises: exList });
  };

  const handleDuplicateExercise = (exerciseIndex) => {
    if (!activeDay) return;
    const exList = [...(activeDay.exercises || [])];
    const target = exList[exerciseIndex];
    const duplicated = {
      ...target,
      id: `ex-dup-${Date.now()}`,
      sort_order: exerciseIndex + 1,
    };
    exList.splice(exerciseIndex + 1, 0, duplicated);
    handleUpdateDay(activeDayIndex, { exercises: exList });
  };

  const handleMoveExercise = (exerciseIndex, direction) => {
    if (!activeDay) return;
    const exList = [...(activeDay.exercises || [])];
    const targetIdx = exerciseIndex + direction;
    if (targetIdx < 0 || targetIdx >= exList.length) return;

    const temp = exList[exerciseIndex];
    exList[exerciseIndex] = exList[targetIdx];
    exList[targetIdx] = temp;
    handleUpdateDay(activeDayIndex, { exercises: exList });
  };

  // ─── 5. Save Workflows ──────────────────────────────────────────────
  const validatePlan = () => {
    if (!name.trim()) {
      setError('Please enter a plan name.');
      return false;
    }
    if (splitType === 'custom' && !customSplitName.trim()) {
      setError('Please enter a name for your custom split.');
      return false;
    }
    if (days.length === 0) {
      setError('Please add at least one training day.');
      return false;
    }
    for (const day of days) {
      for (const ex of (day.exercises || [])) {
        const wu = Number(ex.warmup_sets) || 0;
        const ws = Number(ex.working_sets) || 0;
        if (wu < 0 || ws < 0) {
          setError(`Invalid set values for ${ex.exercise_name}. Warm-up and working sets cannot be negative.`);
          return false;
        }
        if (!Number.isInteger(wu) || !Number.isInteger(ws)) {
          setError(`Set counts for ${ex.exercise_name} must be whole numbers.`);
          return false;
        }
      }
    }
    return true;
  };

  const handleSaveAsTemplate = async () => {
    if (!validatePlan()) return;
    if (!templateName.trim()) return;
    try {
      setSavingTemplate(true);
      const templatePayload = {
        workspace_id: wsId,
        client_id: null,
        name: templateName.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        is_template: true,
        notes: notes.trim() || null,
      };

      await WorkoutsService.create(templatePayload, days);
      setTemplateModalOpen(false);
      setTemplateName('');
      setSuccessMessage('Template saved! Available in Templates tab.');
      setTimeout(() => setSuccessMessage(''), 3500);
    } catch (err) {
      console.error('Error creating template:', err);
      setError('Failed to save workout template.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveAndAssign = () => {
    if (!validatePlan()) return;
    setClientPickerOpen(true);
  };

  const handleAssignToClient = async (client) => {
    try {
      setSaving(true);
      const planPayload = {
        workspace_id: wsId,
        client_id: client.id,
        name: name.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        is_template: false,
        source_template_id: isTemplate ? planId : null,
        notes: notes.trim() || null,
      };

      const assigned = await WorkoutsService.create(planPayload, days);
      setClientPickerOpen(false);
      setSelectedClient(client);
      setPlanId(assigned.id);
      setIsTemplate(false);
      setSuccessMessage(`Assigned to ${client.full_name} successfully!`);
      setTimeout(() => setSuccessMessage(''), 3500);
    } catch (err) {
      console.error('Error assigning plan to client:', err);
      setError('Failed to assign workout plan to client.');
    } finally {
      setSaving(false);
    }
  };

  // ─── 5. In-place save for EXISTING plans / templates ────────────────
  // Editing any saved plan (client program OR template) updates the same
  // row in place instead of silently duplicating it.
  const handleSaveChanges = async () => {
    if (!validatePlan()) return;
    if (!planId) return;
    try {
      setSaving(true);
      const payload = {
        name: name.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        notes: notes.trim() || null,
      };
      const updated = await WorkoutsService.update(planId, payload, days);
      setPlanId(updated.id);
      setSuccessMessage(isTemplate
        ? 'Workout template changes saved successfully!'
        : 'Workout program changes saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3500);
    } catch (err) {
      console.error('Error saving workout plan changes:', err);
      setError('Failed to save workout program changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading workout program builder…" />;

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-16">
      {/* ─── Top Action Bar ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/workouts')}
            className="p-2 rounded-xl bg-secondary/50 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Back to Workout Plans"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary font-mono">
                Workout Plan Builder
              </span>
              <Badge className={cn('text-[10px] font-mono capitalize', isTemplate ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : '')}>
                {isTemplate ? 'Template' : 'Client Plan'}
              </Badge>
              {selectedClient && (
                <Badge className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">
                  Client: {selectedClient.full_name}
                </Badge>
              )}
            </div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {name || 'Untitled Workout Plan'}
            </h1>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            onClick={() => {
              setTemplateName(name ? `${name} (Template)` : 'New Workout Template');
              setTemplateModalOpen(true);
            }}
            className="text-xs"
          >
            <Bookmark className="w-3.5 h-3.5 text-purple-400" /> Save as Template
          </Button>

          <Button
            variant="secondary"
            onClick={planId ? handleSaveChanges : handleSaveAndAssign}
            disabled={saving}
            className="text-xs"
          >
            <Users className="w-3.5 h-3.5 text-primary" /> {saving ? 'Saving…' : (planId ? 'Save Changes' : 'Save & Assign')}
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300">
            ×
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ─── Plan Configuration Header Card ─── */}
      <div className="surface-card p-4 sm:p-5 rounded-2xl border border-border/80 space-y-4">
        <div className={cn(
          'grid gap-4',
          splitType === 'custom' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
        )}>
          {/* Plan Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Plan Name *</label>
            <input
              type="text"
              placeholder="e.g. 4-Day Hypertrophy Block"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
            />
          </div>

          {/* Split Type Selector */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Split Type *</label>
            <select
              value={splitType}
              onChange={(e) => {
                const newSplit = e.target.value;
                setSplitType(newSplit);
                if (newSplit === 'custom') {
                  const customName = customSplitName || 'Session 1';
                  setDays((prev) => prev.map((d, idx) => ({
                    ...d,
                    day_name: idx === 0 ? customName : d.day_name,
                  })));
                }
              }}
              className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
            >
              {SPLIT_TYPES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Split Title (conditional) */}
          {splitType === 'custom' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Custom Split Title *</label>
              <input
                type="text"
                placeholder="e.g. Chest & Back Specialization"
                value={customSplitName}
                onChange={(e) => {
                  setCustomSplitName(e.target.value);
                  if (days.length === 1) {
                    handleUpdateDay(0, { day_name: e.target.value || 'Session 1' });
                  }
                }}
                className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
              />
            </div>
          )}
        </div>

        {/* Plan Notes */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Program Coaching Notes</label>
          <input
            type="text"
            placeholder="e.g. 6-week progressive overload block with deload on week 7..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-8 px-3 rounded-xl bg-secondary/30 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
          />
        </div>
      </div>

      {/* ─── Main Content Grid: Sessions Editor + Volume Overview ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left / Center: Training Days & Exercises (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Day Tabs Bar */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-none">
            <div className="flex items-center gap-1.5 flex-nowrap">
              {days.map((d, dIdx) => (
                <button
                  key={d.id || dIdx}
                  type="button"
                  onClick={() => setActiveDayIndex(dIdx)}
                  className={cn(
                    'px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border',
                    activeDayIndex === dIdx
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-secondary/40 text-muted-foreground hover:text-foreground border-border/60 hover:bg-secondary/70'
                  )}
                >
                  <span>{d.day_name || `Day ${dIdx + 1}`}</span>
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.2 rounded font-mono',
                      activeDayIndex === dIdx ? 'bg-black/20 text-white' : 'bg-secondary text-muted-foreground'
                    )}
                  >
                    {d.exercises?.length || 0}
                  </span>
                </button>
              ))}
            </div>

            <Button variant="secondary" onClick={handleAddDay} className="text-xs whitespace-nowrap shrink-0">
              <Plus className="w-3.5 h-3.5" /> Add Day
            </Button>
          </div>

          {/* Active Day Detail Card */}
          {activeDay && (
            <div className="surface-card p-4 sm:p-5 rounded-2xl border border-border/80 space-y-4">
              {/* Day Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div className="flex items-center gap-3 flex-1">
                  <input
                    type="text"
                    value={activeDay.day_name}
                    onChange={(e) => handleUpdateDay(activeDayIndex, { day_name: e.target.value })}
                    className="text-base font-bold text-foreground bg-transparent border-b border-dashed border-border/80 focus:border-primary focus:outline-none px-1 py-0.5"
                    placeholder="Session Name (e.g. Upper A)"
                  />

                  {/* Rest Day Toggle */}
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!activeDay.rest_day}
                      onChange={(e) => handleUpdateDay(activeDayIndex, { rest_day: e.target.checked })}
                      className="rounded border-border text-primary focus:ring-0"
                    />
                    <span>Rest Day</span>
                  </label>
                </div>

                {/* Session Volume Badge & Delete Day */}
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium px-2.5 py-1 rounded-lg bg-secondary/80 border border-border text-foreground">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span>
                      {volumeData.sessionVolumes[activeDayIndex]?.workingSets || 0} Working Sets
                    </span>
                  </span>

                  {days.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDay(activeDayIndex)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete Training Day"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Day Notes */}
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="Session Coaching Notes (e.g. Focus on chest contraction, keep 2 RIR across compound presses)..."
                  value={activeDay.notes || ''}
                  onChange={(e) => handleUpdateDay(activeDayIndex, { notes: e.target.value })}
                  className="w-full h-8 px-3 rounded-xl bg-secondary/30 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
                />
              </div>

              {/* Exercises List */}
              <div className="space-y-3 pt-2">
                {(activeDay.exercises || []).length === 0 ? (
                  <div className="py-10 text-center space-y-3 border border-dashed border-border/80 rounded-2xl bg-secondary/10">
                    <Dumbbell className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">No exercises added to this session yet</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Import canonical exercises from the library or create custom movements.
                      </p>
                    </div>
                    <Button onClick={() => setSearchModalOpen(true)} className="text-xs">
                      <Plus className="w-3.5 h-3.5" /> Add First Exercise
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(activeDay.exercises || []).map((ex, exIdx) => (
                      <div
                        key={ex.id || exIdx}
                        className="p-3.5 sm:p-4 rounded-xl border border-border/70 bg-secondary/20 hover:border-border transition-all space-y-3"
                      >
                        {/* Exercise Top Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground font-semibold">
                                #{exIdx + 1}
                              </span>
                              <h4 className="text-sm font-semibold text-foreground">{ex.exercise_name}</h4>
                              <Badge className="text-[9px] uppercase font-mono py-0 px-1.5">
                                {ex.category || 'general'}
                              </Badge>
                              {ex.equipment && (
                                <span className="text-[11px] text-muted-foreground font-sans">
                                  ({ex.equipment})
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Exercise Card Actions */}
                          <div className="flex items-center gap-1">
                            {ex.video_url && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveVideoExercise(ex);
                                  setVideoModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-lg hover:bg-blue-500/20 transition-colors"
                                title="Watch Demonstration Video"
                              >
                                <Video className="w-3 h-3" />
                                <span className="hidden sm:inline">Watch Demo</span>
                              </button>
                            )}

                            {/* Reorder Buttons */}
                            <button
                              type="button"
                              onClick={() => handleMoveExercise(exIdx, -1)}
                              disabled={exIdx === 0}
                              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                              title="Move Up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveExercise(exIdx, 1)}
                              disabled={exIdx === (activeDay.exercises.length - 1)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                              title="Move Down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>

                            {/* Duplicate */}
                            <button
                              type="button"
                              onClick={() => handleDuplicateExercise(exIdx)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground"
                              title="Duplicate Exercise"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => handleDeleteExercise(exIdx)}
                              className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                              title="Remove Exercise"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Prescriptions Inline Inputs Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 pt-1 text-xs">
                          {/* Warm-up Sets */}
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Warm-up Sets
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="10"
                              value={ex.warmup_sets ?? 0}
                              onChange={(e) => handleUpdateExercise(exIdx, { warmup_sets: parseInt(e.target.value, 10) || 0 })}
                              className="w-full h-8 px-2 rounded-lg bg-secondary/60 border border-border text-xs font-mono focus:outline-none focus:border-primary/50 text-foreground"
                            />
                          </div>

                          {/* Working Sets */}
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Working Sets
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="30"
                              value={ex.working_sets ?? 3}
                              onChange={(e) => handleUpdateExercise(exIdx, { working_sets: parseInt(e.target.value, 10) || 0 })}
                              className="w-full h-8 px-2 rounded-lg bg-secondary/60 border border-border text-xs font-mono focus:outline-none focus:border-primary/50 text-foreground"
                            />
                          </div>

                          {/* Reps */}
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Target Reps
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. 8-10, AMRAP"
                              value={ex.rep_range}
                              onChange={(e) => handleUpdateExercise(exIdx, { rep_range: e.target.value })}
                              className="w-full h-8 px-2 rounded-lg bg-secondary/60 border border-border text-xs font-mono focus:outline-none focus:border-primary/50 text-foreground"
                            />
                          </div>

                          {/* Target RPE */}
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Target RPE
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="10"
                              step="0.5"
                              value={ex.rpe || ''}
                              onChange={(e) => handleUpdateExercise(exIdx, { rpe: e.target.value })}
                              placeholder="8"
                              className="w-full h-8 px-2 rounded-lg bg-secondary/60 border border-border text-xs font-mono focus:outline-none focus:border-primary/50 text-foreground"
                            />
                          </div>

                          {/* Rest Seconds */}
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Rest (sec)
                            </label>
                            <input
                              type="number"
                              step="15"
                              min="0"
                              value={ex.rest_seconds || 60}
                              onChange={(e) => handleUpdateExercise(exIdx, { rest_seconds: e.target.value })}
                              className="w-full h-8 px-2 rounded-lg bg-secondary/60 border border-border text-xs font-mono focus:outline-none focus:border-primary/50 text-foreground"
                            />
                          </div>

                          {/* Total Sets Display */}
                          <div className="space-y-1 flex flex-col justify-end">
                            <label className="text-[10px] uppercase font-mono text-muted-foreground block">
                              Total Sets
                            </label>
                            <div className="w-full h-8 px-2 rounded-lg bg-secondary/40 border border-border/60 text-xs font-mono flex items-center text-muted-foreground">
                              {(Number(ex.warmup_sets) || 0) + (Number(ex.working_sets) || 0)}
                            </div>
                          </div>
                        </div>

                        {/* Exercise Notes */}
                        <div className="pt-1">
                          <input
                            type="text"
                            placeholder="Exercise technique note (e.g. Slow 3s eccentric, full stretch at bottom)..."
                            value={ex.notes || ''}
                            onChange={(e) => handleUpdateExercise(exIdx, { notes: e.target.value })}
                            className="w-full h-7 px-2.5 rounded-lg bg-secondary/40 border border-border/60 text-[11px] text-muted-foreground focus:text-foreground focus:outline-none focus:border-primary/40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Exercise Trigger Button */}
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setSearchModalOpen(true)}
                    className="w-full text-xs py-2 border border-dashed border-border hover:border-primary/50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Exercise to {activeDay.day_name}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Volume Overview & Muscle Group Distribution (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Total Program Volume Card */}
          <div className="surface-card p-4 rounded-2xl border border-border/80 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-orange-400" /> Volume Summary
              </h3>
              <Badge className="text-[10px] font-mono">
                {volumeData.totalWorkingSets} Total Working Sets
              </Badge>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/60 text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                <strong>YBS Volume Rule:</strong> Total Volume equals the count of working sets. Warm-up sets are excluded.
              </span>
            </div>

            {/* Session Volume Breakdown */}
            <div className="space-y-1.5 pt-1">
              <h4 className="text-[11px] font-semibold text-foreground">Session Working Sets</h4>
              <div className="divide-y divide-border/40 border border-border/60 rounded-xl p-2 bg-secondary/10">
                {volumeData.sessionVolumes.map((sv, idx) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between text-xs">
                    <span className="text-foreground">{sv.dayName}</span>
                    <span className="font-mono font-semibold text-primary">
                      {sv.workingSets} sets
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Muscle Group Distribution Breakdown */}
            <div className="space-y-2 pt-2 border-t border-border/50">
              <h4 className="text-[11px] font-semibold text-foreground">Muscle Group Attribution</h4>
              {volumeData.muscleDistribution.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-2 text-center">
                  Add exercises to calculate muscle-group volume.
                </p>
              ) : (
                <div className="space-y-2">
                  {volumeData.muscleDistribution.map((m) => (
                    <div key={m.muscle} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize text-foreground font-medium">{m.muscle}</span>
                        <span className="font-mono text-muted-foreground text-[11px]">
                          {m.sets} sets ({m.percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-secondary/80 overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${m.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {/* 1. Exercise Search Modal */}
      <ExerciseSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelectExercise={handleAddExerciseToActiveDay}
        workspaceId={wsId || undefined}
      />

      {/* 2. Exercise Video Modal */}
      {activeVideoExercise && (
        <ExerciseVideoModal
          open={videoModalOpen}
          onClose={() => {
            setVideoModalOpen(false);
            setActiveVideoExercise(null);
          }}
          exerciseName={activeVideoExercise.exercise_name}
          videoUrl={activeVideoExercise.video_url}
          instructions={activeVideoExercise.notes}
        />
      )}

      {/* 3. Save as Template Modal */}
      <Modal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title="Save as Reusable Template"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Save this program structure as a reusable workout template. Templates can be cloned and assigned to any client in the workspace without mutating the original template.
          </p>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Template Name *</label>
            <input
              type="text"
              placeholder="e.g. Upper / Lower Hypertrophy (4 Days)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()} className="text-xs">
              {savingTemplate ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 4. Client Assignment Modal */}
      <Modal
        open={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        title="Assign Workout Plan to Client"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Assign this workout plan to a client in your workspace. This creates an independent snapshot instance for the client so subsequent template edits will not affect active client programming.
          </p>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search clients by name or code…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40"
            />
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-border/40 border border-border rounded-xl p-1 bg-secondary/10">
            {clients
              .filter((c) => {
                const q = clientSearch.trim().toLowerCase();
                return !q || c.full_name?.toLowerCase().includes(q) || c.client_code?.toLowerCase().includes(q);
              })
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleAssignToClient(c)}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-secondary/60 flex items-center justify-between text-xs transition-colors group"
                >
                  <div>
                    <span className="font-semibold text-foreground block group-hover:text-primary transition-colors">
                      {c.full_name}
                    </span>
                    {c.client_code && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Code: {c.client_code}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Assign →
                  </span>
                </button>
              ))}
          </div>

          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setClientPickerOpen(false)} className="text-xs">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
