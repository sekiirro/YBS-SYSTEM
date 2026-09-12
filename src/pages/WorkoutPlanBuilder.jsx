import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId, isPlatformAdmin } from '@/lib/ybs-auth';
import { WorkoutsService, calculateWorkoutVolume } from '@/services/workouts';
import { ClientsService } from '@/services/clients';
import { WorkspacesService } from '@/services/workspaces';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import ExerciseSearchModal from '@/components/workouts/ExerciseSearchModal';
import ExerciseVideoModal from '@/components/workouts/ExerciseVideoModal';
import SaveStatus from '@/components/SaveStatus';
import useAutosave from '@/hooks/useAutosave';
import {
  Dumbbell,
  ArrowLeft,
  ArrowLeftRight,
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
  Check,
  GripVertical,
  Lock,
  BedDouble,
  Coffee,
  Pencil,
  MoreVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** @type {any} */
const DropdownMenuContentCmp = DropdownMenuContent;
/** @type {any} */
const DropdownMenuItemCmp = DropdownMenuItem;

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

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministically generates the next duplicate session name.
 * Examples:
 *   "Upper 1" -> "Upper 2" (or "Upper 3" if "Upper 2" exists)
 *   "Upper A" -> "Upper B" (or "Upper C" if "Upper B" exists)
 *   "Rest Day" -> "Rest Day 2" (or "Rest Day 3" if "Rest Day 2" exists)
 *   "Legs" -> "Legs 2"
 */
export function generateDuplicateSessionName(sourceName, existingDays = []) {
  const trimmed = (sourceName || 'Session').trim();
  const dayNames = existingDays.map((d) => (d.day_name || '').trim());

  // 1. Number suffix, e.g. "Upper 1", "Session 2", "Rest Day 1"
  const numberMatch = trimmed.match(/^(.*?)(?:\s+(\d+))$/);
  if (numberMatch) {
    const base = numberMatch[1].trim();
    const currentNum = parseInt(numberMatch[2], 10);
    const regex = new RegExp(`^${escapeRegex(base)}\\s+(\\d+)$`, 'i');
    const used = [];
    dayNames.forEach((name) => {
      const m = name.match(regex);
      if (m) used.push(parseInt(m[1], 10));
    });
    if (dayNames.some((n) => n.toLowerCase() === base.toLowerCase())) {
      used.push(1);
    }
    const maxNum = used.length > 0 ? Math.max(...used, currentNum) : currentNum;
    return `${base} ${maxNum + 1}`;
  }

  // 2. Letter suffix, e.g. "Upper A", "Push B"
  const letterMatch = trimmed.match(/^(.*?)(?:\s+([A-Z]))$/i);
  if (letterMatch) {
    const base = letterMatch[1].trim();
    const currentLetter = letterMatch[2].toUpperCase();
    let maxCharCode = currentLetter.charCodeAt(0);
    const regex = new RegExp(`^${escapeRegex(base)}\\s+([A-Z])$`, 'i');
    dayNames.forEach((name) => {
      const m = name.match(regex);
      if (m) {
        const code = m[1].toUpperCase().charCodeAt(0);
        if (code > maxCharCode) maxCharCode = code;
      }
    });
    return `${base} ${String.fromCharCode(maxCharCode + 1)}`;
  }

  // 3. No suffix, e.g. "Upper", "Leg Day", "Rest Day"
  const regex = new RegExp(`^${escapeRegex(trimmed)}\\s+(\\d+)$`, 'i');
  const used = [];
  dayNames.forEach((name) => {
    const m = name.match(regex);
    if (m) used.push(parseInt(m[1], 10));
  });
  if (used.length > 0) {
    return `${trimmed} ${Math.max(...used) + 1}`;
  }
  return `${trimmed} 2`;
}

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
        day_type: 'session',
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
    day_type: 'session',
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
  const returnTo = searchParams.get('returnTo');
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

  // Workspace the current plan belongs to. For an existing plan this is
  // loaded from the plan row; for new plans it is the current workspace.
  // The exercise picker is NOT necessarily scoped to this workspace — it is
  // scoped to exerciseLibraryWorkspaceId below.
  const [planWorkspaceId, setPlanWorkspaceId] = useState(wsId || null);

  // Workspace whose exercise library this plan's picker reads exercises from.
  // Defaults to the plan's own workspace. Only the Platform Owner can point a
  // plan at a different workspace's library; authorization is enforced
  // server-side by guard_workout_plan_library_source.
  const [exerciseLibraryWorkspaceId, setExerciseLibraryWorkspaceId] = useState(wsId || null);

  // Training Days State
  const [days, setDays] = useState([]);
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  // Modals
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [activeVideoExercise, setActiveVideoExercise] = useState(null);

  // Target exercise index for "Replace Exercise" (null = plain add mode)
  const [replaceIndex, setReplaceIndex] = useState(null);

  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState([]);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Workspaces available to the current user (RLS-authorized). Used to name
  // the current exercise library source and (Platform Owner only) to build
  // the "Change source" selector options.
  const [workspaces, setWorkspaces] = useState([]);
  const [librarySourceOpen, setLibrarySourceOpen] = useState(false);

  // Rest Day Modal State
  const [restDayModalOpen, setRestDayModalOpen] = useState(false);
  const [restDayEditIndex, setRestDayEditIndex] = useState(null);
  const [restDayFormTitle, setRestDayFormTitle] = useState('Rest Day');
  const [restDayFormInstructions, setRestDayFormInstructions] = useState('');

  // Rename Session Modal State
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameIndex, setRenameIndex] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Server baseline for autosave (serialized state as loaded from the DB).
  const [serverSnapshot, setServerSnapshot] = useState(null);

  // ─── 1. Load Initial Plan / Template Data ───────────────────────────
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);

        const clientList = await ClientsService.list({});
        if (isMounted) setClients(clientList || []);

        WorkspacesService.list()
          .then((wsList) => {
            if (isMounted) setWorkspaces(wsList || []);
          })
          .catch((err) => console.error('Error loading workspaces for builder:', err));

        if (id) {
          const plan = await WorkoutsService.getById(id);
          if (isMounted && plan) {
            setPlanId(plan.id);
            setPlanWorkspaceId(plan.workspace_id || wsId || null);
            setExerciseLibraryWorkspaceId(
              plan.exercise_library_workspace_id || plan.workspace_id || wsId || null
            );
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
            const migratedDays = (plan.days || []).map((d, dIdx) => {
              const isRest = d.day_type === 'rest_day' || !!d.rest_day;
              return {
                ...d,
                sort_order: d.sort_order !== undefined ? d.sort_order : dIdx,
                day_type: isRest ? 'rest_day' : 'session',
                rest_day: isRest,
                exercises: isRest ? [] : (d.exercises || []).map((ex) => {
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
              };
            });
            setDays(migratedDays);
            if (isMounted) {
              setServerSnapshot(JSON.stringify([
                plan.name || '',
                plan.split_type || 'upper_lower',
                plan.custom_split_name || '',
                plan.notes || '',
                plan.exercise_library_workspace_id || plan.workspace_id || wsId || null,
                migratedDays,
              ]));
            }
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

            const clonedDays = (tpl.days || []).map((d, dIdx) => {
              const isRest = d.day_type === 'rest_day' || !!d.rest_day;
              return {
                id: `cloned-day-${dIdx}-${Date.now()}`,
                day_name: d.day_name,
                day_type: isRest ? 'rest_day' : 'session',
                sort_order: dIdx,
                rest_day: isRest,
                notes: d.notes || '',
                exercises: isRest ? [] : (d.exercises || []).map((ex, exIdx) => {
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
                    target_weight: ex.target_weight || null,
                    rpe: ex.rpe || 8,
                    warmup: warmupSets > 0 && workingSets === 0,
                    notes: ex.notes || '',
                    group_id: ex.group_id || null,
                    group_type: ex.group_type || null,
                    prescribed_sets_detail: Array.isArray(ex.prescribed_sets_detail)
                      ? JSON.parse(JSON.stringify(ex.prescribed_sets_detail))
                      : [],
                  };
                }),
              };
            });
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

  // ─── 2b. Autosave (server-persistent) ──────────────────────────────
  // Once a plan/template row exists, the latest edits are persisted
  // automatically in place. Brand-new plans (no id) keep the explicit
  // "Save & Assign" flow — autosave never creates rows on its own and never
  // reassigns a plan to a client.
  const autosaveEnabled = !!planId;
  const autosaveSnapshot = JSON.stringify([name, splitType, customSplitName, notes, exerciseLibraryWorkspaceId, days]);
  const autosave = useAutosave({
    id: planId,
    enabled: autosaveEnabled,
    snapshot: autosaveSnapshot,
    lastSavedSnapshot: serverSnapshot,
    save: async () => {
      const payload = {
        name: name.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        notes: notes.trim() || null,
        exercise_library_workspace_id: exerciseLibraryWorkspaceId,
      };
      await WorkoutsService.update(planId, payload, days);
    },
  });

  // Prevent drag initiation when starting on interactive elements
  useEffect(() => {
    const BLOCK = 'INPUT,SELECT,TEXTAREA,BUTTON,[data-no-drag]';
    const handler = (e) => {
      if (e.target.closest(BLOCK)) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, []);

  const handleExerciseDragEnd = (result) => {
    if (!result.destination) return;
    const srcIdx = result.source.index;
    const destIdx = result.destination.index;
    if (srcIdx === destIdx || !activeDay) return;
    const exList = [...(activeDay.exercises || [])];
    const [moved] = exList.splice(srcIdx, 1);
    exList.splice(destIdx, 0, moved);
    const reordered = exList.map((ex, i) => ({ ...ex, sort_order: i }));
    handleUpdateDay(activeDayIndex, { exercises: reordered });
  };

  // ─── 3. Days / Session Management ────────────────────────────────────
  const handleDayDragEnd = (result) => {
    if (!result.destination) return;
    const srcIdx = result.source.index;
    const destIdx = result.destination.index;
    if (srcIdx === destIdx) return;

    const currentActiveDayId = days[activeDayIndex]?.id;

    const reordered = [...days];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(destIdx, 0, moved);

    // Persist sequential sort_order across all sessions & rest days
    const finalized = reordered.map((d, idx) => ({
      ...d,
      sort_order: idx,
    }));

    setDays(finalized);

    // Retain active selection on the same item at its new position
    const newActiveIndex = finalized.findIndex((d) => d.id === currentActiveDayId);
    if (newActiveIndex !== -1) {
      setActiveDayIndex(newActiveIndex);
    }
  };

  const handleAddDay = () => {
    const newDayIndex = days.length;
    const sessionName = generateSessionName(splitType, days, customSplitName);
    const newDay = {
      id: `day-${newDayIndex + 1}-${Date.now()}`,
      day_name: sessionName,
      day_type: 'session',
      sort_order: newDayIndex,
      rest_day: false,
      notes: '',
      exercises: [],
    };
    setDays([...days, newDay]);
    setActiveDayIndex(newDayIndex);
  };

  const handleOpenAddRestDay = () => {
    setRestDayEditIndex(null);
    setRestDayFormTitle('Rest Day');
    setRestDayFormInstructions('');
    setRestDayModalOpen(true);
  };

  const handleOpenEditRestDay = (index) => {
    const target = days[index];
    if (!target) return;
    setRestDayEditIndex(index);
    setRestDayFormTitle(target.day_name || 'Rest Day');
    setRestDayFormInstructions(target.notes || '');
    setRestDayModalOpen(true);
  };

  const handleSaveRestDay = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const title = (restDayFormTitle || 'Rest Day').trim();
    const instructions = restDayFormInstructions.trim();

    if (restDayEditIndex !== null && restDayEditIndex >= 0) {
      handleUpdateDay(restDayEditIndex, {
        day_name: title,
        notes: instructions,
        rest_day: true,
        day_type: 'rest_day',
      });
      setRestDayModalOpen(false);
    } else {
      const insertAt = activeDayIndex >= 0 && activeDayIndex < days.length
        ? activeDayIndex + 1
        : days.length;

      const newDay = {
        id: `day-rest-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        day_name: title,
        day_type: 'rest_day',
        sort_order: insertAt,
        rest_day: true,
        notes: instructions,
        exercises: [],
      };

      const updated = [...days];
      updated.splice(insertAt, 0, newDay);
      const reindexed = updated.map((d, idx) => ({
        ...d,
        sort_order: idx,
      }));

      setDays(reindexed);
      setActiveDayIndex(insertAt);
      setRestDayModalOpen(false);
    }
  };

  const handleDuplicateDay = (sourceIndex) => {
    const source = days[sourceIndex];
    if (!source) return;

    const isRest = source.day_type === 'rest_day' || !!source.rest_day;
    const newName = generateDuplicateSessionName(source.day_name, days);
    const newDayId = `day-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Critical Deep Copy of exercises: fresh IDs, cloned prescribed sets detail
    const copiedExercises = (source.exercises || []).map((ex, exIdx) => {
      const newExId = `ex-dup-${Date.now()}-${exIdx}-${Math.random().toString(36).substr(2, 6)}`;
      return {
        ...ex,
        id: newExId,
        workout_day_id: newDayId,
        sort_order: exIdx,
        exercise_id: ex.exercise_id || null,
        exercise_name: ex.exercise_name || ex.name || '',
        category: ex.category || 'other',
        muscle_group: ex.muscle_group || null,
        equipment: ex.equipment || null,
        video_url: ex.video_url || null,
        warmup_sets: ex.warmup_sets !== undefined ? Number(ex.warmup_sets) : 0,
        working_sets: ex.working_sets !== undefined ? Number(ex.working_sets) : Number(ex.sets || 3),
        sets: Number(ex.sets || 3),
        rep_range: ex.rep_range || '8-12',
        rest_seconds: Number(ex.rest_seconds) || 60,
        target_weight: ex.target_weight || null,
        warmup: !!ex.warmup,
        rpe: ex.rpe ? Number(ex.rpe) : null,
        notes: ex.notes || '',
        group_id: ex.group_id || null,
        group_type: ex.group_type || null,
        prescribed_sets_detail: Array.isArray(ex.prescribed_sets_detail)
          ? JSON.parse(JSON.stringify(ex.prescribed_sets_detail))
          : [],
      };
    });

    const duplicatedDay = {
      id: newDayId,
      day_name: newName,
      day_type: isRest ? 'rest_day' : 'session',
      rest_day: isRest,
      notes: source.notes || '',
      exercises: copiedExercises,
      sort_order: sourceIndex + 1,
    };

    // Insert immediately after source session
    const updated = [...days];
    updated.splice(sourceIndex + 1, 0, duplicatedDay);

    const reindexed = updated.map((d, idx) => ({
      ...d,
      sort_order: idx,
    }));

    setDays(reindexed);
    setActiveDayIndex(sourceIndex + 1);
  };

  const handleOpenRename = (index) => {
    const target = days[index];
    if (!target) return;
    setRenameIndex(index);
    setRenameTitle(target.day_name || '');
    setRenameModalOpen(true);
  };

  const handleSaveRename = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (renameIndex !== null && renameIndex >= 0) {
      const trimmed = renameTitle.trim();
      if (trimmed) {
        handleUpdateDay(renameIndex, { day_name: trimmed });
      }
    }
    setRenameModalOpen(false);
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
      alert('A workout plan must have at least one session or program item.');
      return;
    }
    const target = days[index];
    const isRest = target?.day_type === 'rest_day' || !!target?.rest_day;
    const label = isRest ? (target.day_name || 'Rest Day') : (target.day_name || `Session ${index + 1}`);
    if (!window.confirm(`Delete ${label}?`)) return;

    const remaining = days.filter((_, idx) => idx !== index);
    const reindexed = remaining.map((d, idx) => ({
      ...d,
      sort_order: idx,
    }));

    setDays(reindexed);
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

  const handleReplaceExercise = (exerciseIndex) => {
    setReplaceIndex(exerciseIndex);
    setSearchModalOpen(true);
  };

  const handleReplaceExerciseSelect = (exercisePayload) => {
    if (!activeDay) return;
    const exList = [...(activeDay.exercises || [])];
    if (replaceIndex === null || replaceIndex < 0 || replaceIndex >= exList.length) return;
    const prev = exList[replaceIndex];

    // Swap only the exercise identity/reference. The existing slot, sort
    // order, and every prescription field (sets, reps, rest, RPE, warm-up,
    // working sets, notes, group/superset metadata, prescribed sets, …)
    // are preserved via the spread of `prev`.
    const replaced = {
      ...prev,
      exercise_id: exercisePayload.exercise_id,
      exercise_name: exercisePayload.exercise_name,
      category: exercisePayload.category,
      muscle_group: exercisePayload.muscle_group,
      equipment: exercisePayload.equipment,
      video_url: exercisePayload.video_url ?? null,
    };

    exList[replaceIndex] = replaced;
    setReplaceIndex(null);
    handleUpdateDay(activeDayIndex, { exercises: exList });
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
    if (!wsId) {
      setError('No active workspace found. Join or switch to a workspace before saving this plan.');
      return false;
    }
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
        workspace_id: planWorkspaceId || wsId,
        client_id: null,
        name: templateName.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        is_template: true,
        notes: notes.trim() || null,
        exercise_library_workspace_id: exerciseLibraryWorkspaceId || planWorkspaceId || wsId,
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
      await autosave.flush();
      setSaving(true);
      const planPayload = {
        workspace_id: planWorkspaceId || wsId,
        client_id: client.id,
        assigned_ybs_coach_id: user?.id || null,
        name: name.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        is_template: false,
        source_template_id: isTemplate ? planId : null,
        notes: notes.trim() || null,
        exercise_library_workspace_id: exerciseLibraryWorkspaceId || planWorkspaceId || wsId,
      };

      const assigned = await WorkoutsService.create(planPayload, days);
      setClientPickerOpen(false);
      setSelectedClient(client);
      setPlanId(assigned.id);
      setIsTemplate(false);
      autosave.reset();
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
      await autosave.flush();
      setSaving(true);
      const payload = {
        name: name.trim(),
        split_type: splitType,
        custom_split_name: splitType === 'custom' ? customSplitName.trim() : null,
        notes: notes.trim() || null,
        exercise_library_workspace_id: exerciseLibraryWorkspaceId,
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

  const libraryWorkspace = workspaces.find((w) => w.id === exerciseLibraryWorkspaceId);
  const canChooseLibrarySource = isPlatformAdmin(user);

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-16">
      {/* ─── Top Action Bar ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => { await autosave.flush(); navigate(returnTo || '/workouts'); }}
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

          <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
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

        {/* Exercise Library Source */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-secondary/20 border border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <label className="text-xs font-semibold text-foreground">Exercise Library Source</label>
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
              <Info className="w-3 h-3 shrink-0" />
              The exercise picker browses exercises owned by this workspace.
              {libraryWorkspace && (
                <span>
                  Currently:{' '}
                  <span className="font-semibold text-foreground">{libraryWorkspace.name}</span>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canChooseLibrarySource ? (
              <Button variant="secondary" onClick={() => setLibrarySourceOpen(true)} className="text-xs">
                Change
              </Button>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                title="Only the Platform Owner can point a plan at another workspace's exercise library."
              >
                <Lock className="w-3 h-3" />
                Locked
              </span>
            )}
          </div>
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
            <DragDropContext onDragEnd={handleDayDragEnd}>
              <Droppable droppableId="day-tabs" direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex items-center gap-1.5 flex-nowrap"
                  >
                    {days.map((d, dIdx) => {
                      const isRest = d.day_type === 'rest_day' || !!d.rest_day;
                      const isActive = activeDayIndex === dIdx;

                      return (
                        <Draggable key={d.id || `day-${dIdx}`} draggableId={d.id || `day-${dIdx}`} index={dIdx}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(
                                'group relative flex items-center rounded-xl transition-all border shrink-0 select-none',
                                isActive
                                  ? isRest
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                                    : 'bg-primary text-primary-foreground border-primary shadow-sm'
                                  : isRest
                                    ? 'bg-amber-500/5 text-amber-400/90 hover:text-amber-300 border-amber-500/30 hover:bg-amber-500/10'
                                    : 'bg-secondary/40 text-muted-foreground hover:text-foreground border-border/60 hover:bg-secondary/70',
                                dragSnapshot.isDragging && 'shadow-xl ring-2 ring-primary/60 opacity-95 z-50'
                              )}
                            >
                              {/* Drag Handle */}
                              <div
                                {...dragProvided.dragHandleProps}
                                className={cn(
                                  'pl-2 pr-1 py-2 cursor-grab active:cursor-grabbing transition-opacity',
                                  isActive ? 'text-current opacity-70 hover:opacity-100' : 'text-muted-foreground opacity-40 group-hover:opacity-100 hover:opacity-100'
                                )}
                                title="Drag to reorder session"
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </div>

                              {/* Tab Click Target */}
                              <button
                                type="button"
                                onClick={() => setActiveDayIndex(dIdx)}
                                className="py-2 pr-1.5 text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 focus:outline-none"
                              >
                                {isRest ? (
                                  <>
                                    <BedDouble className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                                    <span>{d.day_name || 'Rest Day'}</span>
                                    <span
                                      className={cn(
                                        'text-[9px] px-1.5 py-0.2 rounded font-mono font-medium',
                                        isActive ? 'bg-amber-500/30 text-amber-200' : 'bg-amber-500/15 text-amber-400/90'
                                      )}
                                    >
                                      Rest
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span>{d.day_name || `Day ${dIdx + 1}`}</span>
                                    <span
                                      className={cn(
                                        'text-[10px] px-1.5 py-0.2 rounded font-mono',
                                        isActive ? 'bg-black/20 text-white' : 'bg-secondary text-muted-foreground'
                                      )}
                                    >
                                      {d.exercises?.length || 0}
                                    </span>
                                  </>
                                )}
                              </button>

                              {/* Tab Actions Dropdown Menu */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                      'p-1.5 mr-1 rounded-md transition-all',
                                      isActive
                                        ? 'hover:bg-black/20 text-current opacity-80 hover:opacity-100'
                                        : 'hover:bg-secondary text-muted-foreground hover:text-foreground opacity-40 group-hover:opacity-100'
                                    )}
                                    title="Session options"
                                  >
                                    <MoreVertical className="w-3.5 h-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContentCmp align="end" className="w-44">
                                  {isRest ? (
                                    <>
                                      <DropdownMenuItemCmp onClick={() => handleOpenEditRestDay(dIdx)}>
                                        <Pencil className="w-3.5 h-3.5 mr-2 text-amber-400" /> Edit Instructions
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuItemCmp onClick={() => handleDuplicateDay(dIdx)}>
                                        <Copy className="w-3.5 h-3.5 mr-2 text-primary" /> Duplicate
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItemCmp
                                        onClick={() => handleDeleteDay(dIdx)}
                                        className="text-red-400 focus:text-red-300 focus:bg-red-500/10"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                      </DropdownMenuItemCmp>
                                    </>
                                  ) : (
                                    <>
                                      <DropdownMenuItemCmp onClick={() => handleOpenRename(dIdx)}>
                                        <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuItemCmp onClick={() => handleDuplicateDay(dIdx)}>
                                        <Copy className="w-3.5 h-3.5 mr-2 text-primary" /> Duplicate
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItemCmp
                                        onClick={() => handleDeleteDay(dIdx)}
                                        className="text-red-400 focus:text-red-300 focus:bg-red-500/10"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                      </DropdownMenuItemCmp>
                                    </>
                                  )}
                                </DropdownMenuContentCmp>
                              </DropdownMenu>
                            </div>
                          )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {/* Add Session & Add Rest Day Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="secondary" onClick={handleAddDay} className="text-xs whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" /> Add Session
            </Button>
            <Button
              variant="secondary"
              onClick={handleOpenAddRestDay}
              className="text-xs whitespace-nowrap text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            >
              <BedDouble className="w-3.5 h-3.5" /> + Rest Day
            </Button>
          </div>
        </div>

        {/* Active Day Detail Card */}
        {activeDay && (
          (activeDay.day_type === 'rest_day' || !!activeDay.rest_day) ? (
            /* Dedicated Rest Day Card */
            <div className="surface-card p-4 sm:p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-transparent space-y-4">
              {/* Rest Day Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div className="flex items-center gap-2.5 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                    <BedDouble className="w-4 h-4" />
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={activeDay.day_name || 'Rest Day'}
                      onChange={(e) => handleUpdateDay(activeDayIndex, { day_name: e.target.value })}
                      className="text-base font-bold text-foreground bg-transparent border-b border-dashed border-border/80 focus:border-amber-500 focus:outline-none px-1 py-0.5"
                      placeholder="Rest Day Title"
                    />
                    <Badge className="text-[10px] font-mono bg-amber-500/15 text-amber-300 border-amber-500/30">
                      Recovery Day
                    </Badge>
                  </div>
                </div>

                {/* Rest Day Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenEditRestDay(activeDayIndex)}
                    className="text-xs h-8 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Instructions
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDuplicateDay(activeDayIndex)}
                    className="text-xs h-8"
                    title="Duplicate Rest Day"
                  >
                    <Copy className="w-3.5 h-3.5 text-primary" /> Duplicate
                  </Button>

                  {days.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDay(activeDayIndex)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete Rest Day"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Rest Day Instructions Box */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Coffee className="w-3.5 h-3.5 text-amber-400" /> Rest Day Coaching Instructions
                  </label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Autosaves with plan
                  </span>
                </div>

                <textarea
                  rows={5}
                  value={activeDay.notes || ''}
                  onChange={(e) => handleUpdateDay(activeDayIndex, { notes: e.target.value })}
                  placeholder="Keep activity light today.&#10;8–10k steps.&#10;Stay hydrated.&#10;No resistance training."
                  className="w-full p-3.5 rounded-xl bg-secondary/30 border border-border text-xs focus:outline-none focus:border-amber-500/50 text-foreground leading-relaxed resize-none"
                />
              </div>

              {/* Helpful Recovery Guidance Card */}
              <div className="p-3.5 rounded-xl bg-secondary/20 border border-border/50 text-xs space-y-1 text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-amber-400" /> Scheduled Recovery Item
                </div>
                <p className="text-[11px] leading-relaxed">
                  Rest days do not contain exercises. This item is positioned in your training split sequence and displays your custom recovery instructions directly to the client.
                </p>
              </div>
            </div>
          ) : (
            /* Training Session Card */
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
                </div>

                {/* Session Volume Badge, Duplicate & Delete Day */}
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium px-2.5 py-1 rounded-lg bg-secondary/80 border border-border text-foreground">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span>
                      {volumeData.sessionVolumes[activeDayIndex]?.workingSets || 0} Working Sets
                    </span>
                  </span>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDuplicateDay(activeDayIndex)}
                    className="text-xs h-8"
                    title="Duplicate this session"
                  >
                    <Copy className="w-3.5 h-3.5 text-primary" /> Duplicate
                  </Button>

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
                  <DragDropContext onDragEnd={handleExerciseDragEnd}>
                    <Droppable droppableId="exercises">
                      {(dropProvided) => (
                        <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-3">
                    {(activeDay.exercises || []).map((ex, exIdx) => (
                      <Draggable key={ex.id || `ex-${exIdx}`} draggableId={ex.id || `ex-${exIdx}`} index={exIdx}>
                        {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={cn(
                            'p-3.5 sm:p-4 rounded-xl border border-border/70 bg-secondary/20 hover:border-border transition-all space-y-3',
                            snapshot.isDragging ? 'shadow-lg shadow-black/10 ring-2 ring-primary/30' : ''
                          )}
                        >
                        {/* Exercise Top Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <div
                              {...dragProvided.dragHandleProps}
                              className={cn(
                                'w-6 h-6 mt-0.5 rounded flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing transition-colors',
                                snapshot.isDragging
                                  ? 'bg-primary/20 border border-primary/30 text-primary'
                                  : 'bg-secondary/50 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary'
                              )}
                              title="Drag to reorder exercise"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </div>
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

                            {/* Replace Exercise */}
                            <button
                              type="button"
                              onClick={() => handleReplaceExercise(exIdx)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground"
                              title="Replace Exercise"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
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
                      )}
                      </Draggable>
                    ))}
                    {dropProvided.placeholder}
                    </div>
                    )}
                  </Droppable>
                </DragDropContext>
                )}

                {/* Add Exercise Trigger Button */}
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setReplaceIndex(null);
                      setSearchModalOpen(true);
                    }}
                    className="w-full text-xs py-2 border border-dashed border-border hover:border-primary/50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Exercise to {activeDay.day_name}
                  </Button>
                </div>
              </div>
            </div>
            )
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
        onClose={() => {
          setReplaceIndex(null);
          setSearchModalOpen(false);
        }}
        onSelectExercise={(exercisePayload) => {
          if (replaceIndex !== null) {
            handleReplaceExerciseSelect(exercisePayload);
          } else {
            handleAddExerciseToActiveDay(exercisePayload);
          }
        }}
        workspaceId={exerciseLibraryWorkspaceId || planWorkspaceId || undefined}
        title={replaceIndex !== null ? 'Replace Exercise' : 'Select Exercise from Library'}
        confirmLabel={replaceIndex !== null ? 'Replace' : 'Add'}
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

      {/* 5. Exercise Library Source Modal */}
      <Modal
        open={librarySourceOpen}
        onClose={() => setLibrarySourceOpen(false)}
        title="Exercise Library Source"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose which workspace's exercise library this plan browses. Only workspaces you have access to are listed. Exercises already added to this plan are kept unchanged.
          </p>

          {workspaces.length === 0 ? (
            <p className="text-xs text-muted-foreground">No workspaces available.</p>
          ) : (
            <div className="space-y-2">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    setExerciseLibraryWorkspaceId(w.id);
                    setLibrarySourceOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all',
                    exerciseLibraryWorkspaceId === w.id
                      ? 'bg-primary/10 border-primary/50 text-foreground'
                      : 'bg-secondary/40 border-border/60 text-foreground hover:bg-secondary'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{w.name}</span>
                    {exerciseLibraryWorkspaceId === w.id && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{w.id}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setLibrarySourceOpen(false)} className="text-xs">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      {/* 6. Rest Day Modal */}
      <Modal
        open={restDayModalOpen}
        onClose={() => setRestDayModalOpen(false)}
        title={restDayEditIndex !== null ? 'Edit Rest Day Instructions' : 'Add Rest Day'}
        size="md"
      >
        <form onSubmit={handleSaveRestDay} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Rest Day Title</label>
            <input
              type="text"
              value={restDayFormTitle}
              onChange={(e) => setRestDayFormTitle(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-amber-500 text-foreground"
              placeholder="e.g. Rest Day, Active Recovery, Deload Day"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Rest Day Instructions</label>
            <textarea
              rows={6}
              value={restDayFormInstructions}
              onChange={(e) => setRestDayFormInstructions(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-amber-500 text-foreground resize-none leading-relaxed"
              placeholder="Keep activity light today.\n8–10k steps.\nStay hydrated.\nNo resistance training."
            />
            <p className="text-[11px] text-muted-foreground">
              These instructions are presented directly to the client as an ordered recovery milestone in their program.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRestDayModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              <Check className="w-3.5 h-3.5" /> {restDayEditIndex !== null ? 'Save Instructions' : 'Save Rest Day'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 7. Rename Session Modal */}
      <Modal
        open={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        title="Rename Session"
        size="sm"
      >
        <form onSubmit={handleSaveRename} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Session Name</label>
            <input
              type="text"
              autoFocus
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary text-foreground"
              placeholder="e.g. Upper 1, Push A"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenameModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="text-xs"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
