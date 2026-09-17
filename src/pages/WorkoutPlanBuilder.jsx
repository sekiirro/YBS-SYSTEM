import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { PanelGroup, Panel } from 'react-resizable-panels';
import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId, isPlatformAdmin } from '@/lib/ybs-auth';
import { WorkoutsService, calculateWorkoutVolume } from '@/services/workouts';
import { ClientsService } from '@/services/clients';
import { WorkspacesService } from '@/services/workspaces';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PlannerResizeHandle } from '@/components/workouts/PremiumPlannerLayout';
import ExerciseSearchModal from '@/components/workouts/ExerciseSearchModal';
import ExerciseVideoModal from '@/components/workouts/ExerciseVideoModal';
import ExerciseVersionLinkModal from '@/components/workouts/ExerciseVersionLinkModal';
import SaveStatus from '@/components/SaveStatus';
import useAutosave from '@/hooks/useAutosave';
import { ExerciseVersioningService } from '@/services/exerciseVersioning';
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
  MoreHorizontal,
  Link2,
  X,
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

export default function WorkoutPlanBuilder(props = {}) {
  const {
    initialPlanId: propPlanId,
    templateId: propTemplateId,
    clientId: propClientId,
    clientName: propClientName,
    workspaceId: propWorkspaceId,
    sidebarSlot,
    onPlanSaved,
    embedded = false,
    onExit,
  } = props;
  const { id: routeId } = useParams();
  const [searchParams] = useSearchParams();
  const templateId = propTemplateId || searchParams.get('templateId');
  const queryClientId = propClientId || searchParams.get('clientId');
  const queryClientName = propClientName || null;
  const returnTo = searchParams.get('returnTo');
  const navigate = useNavigate();
  const { user } = useAuth();
  const activeWsId = getActiveWorkspaceId(user);
  const wsId = propWorkspaceId || activeWsId;
  // Embedded builders mount under /clients/:id, where useParams().id is the
  // CLIENT id — it must never be mistaken for a workout plan id. Only the
  // standalone /workouts/builder/:id route carries a plan id in the URL.
  const id = propPlanId || (!embedded ? routeId : undefined);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Synchronous in-flight lock so repetitive clicks on an assignment target
  // (or a double-click before React re-renders disabled state) can never fire
  // a second full INSERT. Each lock is released in `finally`.
  const assigningRef = useRef(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Plan Meta State
  const [planId, setPlanId] = useState(propPlanId || id || null);
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
  const [activeDayIndex, setActiveDayIndex] = useState(embedded ? null : 0);
  const [mobileStep, setMobileStep] = useState(2);

  // Modals
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [activeVideoExercise, setActiveVideoExercise] = useState(null);

  // Platform-owner "Link exercise versions" modal (targets one exercise).
  const [versionLinkExercise, setVersionLinkExercise] = useState(null); // { id, name } | null

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

  // Destructive Action Confirmation Dialogs
  const [dayToDeleteIndex, setDayToDeleteIndex] = useState(null);
  const [exerciseToDeleteIndex, setExerciseToDeleteIndex] = useState(null);

  // Server baseline for autosave (serialized state as loaded from the DB).
  const [serverSnapshot, setServerSnapshot] = useState(null);
  // Becomes true only after the load effect finishes hydrating state for the
  // requested mode. Autosave stays disabled until then so no PATCH can fire
  // with default/blank state or before a failed load is reported.
  const [initialized, setInitialized] = useState(false);

  // ─── 1. Load Initial Plan / Template Data ───────────────────────────
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);

        // Client selector must never block plan loading: a client-list
        // failure degrades to an empty selector, the plan still loads.
        let clientList = [];
        try {
          clientList = await ClientsService.list({}) || [];
        } catch (listErr) {
          console.error('Error loading clients for builder:', listErr);
          clientList = [];
        }
        if (isMounted) setClients(clientList);

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
            if (isMounted) setInitialized(true);
          } else if (isMounted) {
            // Never silently fall through to a blank plan when an explicit
            // plan id was requested but no row came back.
            setError('Failed to load workout program data.');
            setLoading(false);
            return;
          }
        } else if (templateId) {
          const tpl = await WorkoutsService.getById(templateId);
          if (isMounted && tpl) {
            setPlanId(null);
            setName(tpl.name);
            setSplitType(tpl.split_type || 'upper_lower');
            setCustomSplitName(tpl.custom_split_name || '');
            setNotes(tpl.notes || '');
            setIsTemplate(false);

            // Version resolution runs ONCE at template LOAD time. Each item
            // resolves canonical -> target-workspace version -> YBS Global
            // version -> original. Only identity fields (exercise_id, name,
            // video, category…) are replaced; every programming column is
            // preserved. Never retroactive on already-assigned plans.
            let baseDays = tpl.days || [];
            if (wsId && tpl.workspace_id !== wsId) {
              try {
                const resolved = await ExerciseVersioningService.resolvePlanForWorkspace(tpl.id, wsId);
                baseDays = ExerciseVersioningService.applyResolution(baseDays, resolved.exercisesById, resolved.resolutions);
              } catch (resolveErr) {
                console.error('Failed to resolve template exercise versions:', resolveErr);
              }
            }

            const clonedDays = (baseDays || []).map((d, dIdx) => {
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
                    rpe: ex.rpe ? Number(ex.rpe) : 1,
                    warmup: warmupSets > 0 && workingSets === 0,
                    notes: ex.notes || '',
                    group_id: ex.group_id || null,
                    group_type: ex.group_type || null,
                    prescribed_sets_detail: Array.isArray(ex.prescribed_sets_detail)
                      ? JSON.parse(JSON.stringify(ex.prescribed_sets_detail))
                      : [],
                    _versionInfo: ex._versionInfo || null,
                  };
                }),
              };
            });
            setDays(clonedDays);

            if (queryClientId) {
              const matched = clientList.find((c) => c.id === queryClientId);
              setSelectedClient(matched || (queryClientName ? { id: queryClientId, full_name: queryClientName } : null));
            }
            if (isMounted) setInitialized(true);
          }
        } else {
          setName('New Workout Program');
          setIsTemplate(searchParams.get('type') === 'template');
          setSplitType('upper_lower');
          setDays(getDefaultDays('upper_lower', ''));

          if (queryClientId) {
            const matched = clientList.find((c) => c.id === queryClientId);
            setSelectedClient(matched || (queryClientName ? { id: queryClientId, full_name: queryClientName } : null));
          }
          if (isMounted) setInitialized(true);
        }
      } catch (err) {
        console.error('Error loading workout builder data:', err);
        setError('Failed to load workout program data.');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [id, templateId, queryClientId, queryClientName]);

  // ─── 2. Live Volume Calculations ────────────────────────────────────
  const volumeData = useMemo(() => {
    return calculateWorkoutVolume(days);
  }, [days]);

  const activeDay = activeDayIndex !== null && activeDayIndex >= 0 ? (days[activeDayIndex] || null) : null;

  // ─── 2b. Autosave (server-persistent) ──────────────────────────────
  // Once a plan/template row exists AND the load effect has finished
  // hydrating state, the latest edits are persisted automatically in place.
  // Brand-new plans (no id) keep the explicit "Save & Assign" flow —
  // autosave never creates rows on its own and never reassigns a plan
  // to a client. The initialized gate additionally guarantees no PATCH
  // can fire with default/blank state or after a failed load.
  const autosaveEnabled = !!planId && initialized;
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

  // Drain any pending autosave when this builder unmounts (Client Detail tab
  // switch, program switch, route change) so edits already applied to the UI
  // are never lost. `flush` is referentially stable so this only runs on real
  // unmount, and it is a no-op when there is nothing to persist.
  useEffect(() => () => { void autosave.flush(); }, [autosave.flush]);

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
      setError('A workout plan must have at least one session or program item.');
      return;
    }
    setDayToDeleteIndex(index);
  };

  const executeDeleteDay = () => {
    if (dayToDeleteIndex === null || dayToDeleteIndex < 0 || dayToDeleteIndex >= days.length) return;
    const index = dayToDeleteIndex;
    const remaining = days.filter((_, idx) => idx !== index);
    const reindexed = remaining.map((d, idx) => ({
      ...d,
      sort_order: idx,
    }));

    setDays(reindexed);
    setActiveDayIndex((prev) => Math.max(0, prev >= index ? prev - 1 : prev));
    setDayToDeleteIndex(null);
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
    // order, and every prescription field (sets, reps, rest, RIR, warm-up,
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
    setExerciseToDeleteIndex(exerciseIndex);
  };

  const executeDeleteExercise = () => {
    if (exerciseToDeleteIndex === null || !activeDay) return;
    const exList = (activeDay.exercises || []).filter((_, idx) => idx !== exerciseToDeleteIndex);
    handleUpdateDay(activeDayIndex, { exercises: exList });
    setExerciseToDeleteIndex(null);
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
    // When the builder was opened from a client's page (`clientId` query
    // param), the client is already pre-selected from the RLS-authorized
    // client list. Assign directly without re-opening the picker — the
    // assigningRef in-flight guard keeps repeated clicks from ever firing a
    // second INSERT. Generic mode (no clientId) keeps the existing picker.
    if (queryClientId && selectedClient) {
      handleAssignToClient(selectedClient);
      return;
    }
    setClientPickerOpen(true);
  };

  const handleAssignToClient = async (client) => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    setSaving(true);
    try {
      await autosave.flush();
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
      onPlanSaved?.(assigned);
      setSuccessMessage(`Assigned to ${client.full_name} successfully!`);
      setTimeout(() => setSuccessMessage(''), 3500);
    } catch (err) {
      console.error('Error assigning plan to client:', err);
      setError('Failed to assign workout plan to client.');
    } finally {
      assigningRef.current = false;
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
      onPlanSaved?.(updated);
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

  if (loading) {
    return (
      <div className={cn(
        'w-full bg-background select-none',
        embedded
          ? 'flex flex-col h-full overflow-hidden'
          : 'flex flex-col h-[calc(100vh-56px)] overflow-hidden'
      )}>
        {/* Top bar skeleton */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40 bg-card/60 shrink-0">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-5 w-32 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>

        {/* Multi-column layout skeleton */}
        <div className="flex-1 flex overflow-hidden">
          {sidebarSlot ? (
            <div className="w-64 border-r border-border/40 shrink-0 hidden md:flex flex-col overflow-hidden">
              {sidebarSlot}
            </div>
          ) : !embedded ? (
            <div className="w-64 border-r border-border/40 p-4 space-y-4 shrink-0 hidden md:block bg-card/20">
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : null}

          {/* Col 2: Day cards skeleton */}
          <div className="w-72 md:w-80 border-r border-border/40 p-3 space-y-2 shrink-0 bg-card/10">
            <div className="flex items-center justify-between px-1 py-1">
              <Skeleton className="h-4 w-24 rounded-md" />
              <Skeleton className="h-3 w-12 rounded-md" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-3 rounded-xl border border-border/40 bg-card/40 space-y-2">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="w-7 h-7 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3.5 w-3/4 rounded-md" />
                    <Skeleton className="h-2.5 w-1/2 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Col 3: Exercise editor skeleton */}
          <div className="flex-1 p-4 space-y-3 overflow-hidden bg-background">
            <div className="flex items-center justify-between pb-3 border-b border-border/40">
              <div className="space-y-1">
                <Skeleton className="h-3 w-32 rounded-md" />
                <Skeleton className="h-5 w-48 rounded-md" />
              </div>
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-7 w-7 rounded-lg" />
                <Skeleton className="h-7 w-7 rounded-lg" />
              </div>
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3.5 rounded-xl border border-border/40 bg-card/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-5 h-5 rounded" />
                    <Skeleton className="h-4 w-40 rounded-md" />
                    <Skeleton className="h-4 w-16 rounded-md" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-md" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  {[1, 2, 3, 4, 5].map((c) => (
                    <div key={c} className="space-y-1">
                      <Skeleton className="h-2.5 w-12 rounded-md" />
                      <Skeleton className="h-8 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const libraryWorkspace = workspaces.find((w) => w.id === exerciseLibraryWorkspaceId);
  const canChooseLibrarySource = isPlatformAdmin(user);

  // ─── Derived UI state ──────────────────────────────────────────────
  // A training day (not rest) is selected → Column 3 opens.
  // Rest days render their own recovery view inside Column 2/3 area.
  const selectedDayIsSession = activeDay && !(activeDay.day_type === 'rest_day' || !!activeDay.rest_day);
  const showExercisePanel = !!activeDay; // Column 3 always shows when ANY day is selected

  // ─── Column content: Config sidebar (standalone only) ──────────────
  const configSidebarContent = (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary font-mono">Plan Builder</span>
          <Badge className={cn('text-[9px] font-mono capitalize shrink-0', isTemplate ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-secondary text-muted-foreground border-border')}>
            {isTemplate ? 'Template' : 'Client Plan'}
          </Badge>
        </div>
        <h1 className="text-[13px] font-bold text-foreground truncate" title={name || 'Untitled'}>
          {name || <span className="text-muted-foreground italic">Untitled</span>}
        </h1>
        {selectedClient && (
          <p className="text-[11px] text-primary font-medium mt-0.5 truncate">{selectedClient.full_name}</p>
        )}
      </div>

      {/* Scrollable config body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Plan Name */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plan Name</label>
          <input
            type="text"
            placeholder="e.g. 4-Day Hypertrophy Block"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-8 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
          />
        </div>

        {/* Split Type */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Split Type</label>
          <select
            value={splitType}
            onChange={(e) => {
              const newSplit = e.target.value;
              setSplitType(newSplit);
              if (newSplit === 'custom') {
                const customName = customSplitName || 'Session 1';
                setDays((prev) => prev.map((d, idx) => ({ ...d, day_name: idx === 0 ? customName : d.day_name })));
              }
            }}
            className="w-full h-8 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
          >
            {SPLIT_TYPES.map((st) => (
              <option key={st.id} value={st.id}>{st.label}</option>
            ))}
          </select>
        </div>

        {/* Custom Split Name */}
        {splitType === 'custom' && (
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom Split Title</label>
            <input
              type="text"
              placeholder="e.g. Chest & Back Specialization"
              value={customSplitName}
              onChange={(e) => {
                setCustomSplitName(e.target.value);
                if (days.length === 1) handleUpdateDay(0, { day_name: e.target.value || 'Session 1' });
              }}
              className="w-full h-8 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
            />
          </div>
        )}

        {/* Coaching Notes */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coaching Notes</label>
          <textarea
            rows={3}
            placeholder="e.g. 6-week progressive overload…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground resize-none leading-relaxed"
          />
        </div>

        {/* Exercise Library Source */}
        <div className="rounded-lg bg-secondary/20 border border-border/60 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Exercise Library</label>
            {canChooseLibrarySource ? (
              <button type="button" onClick={() => setLibrarySourceOpen(true)} className="text-[10px] text-primary hover:underline">
                Change
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="w-2.5 h-2.5" /> Locked
              </span>
            )}
          </div>
          {libraryWorkspace && (
            <p className="text-[10px] text-muted-foreground">
              Source: <span className="font-semibold text-foreground">{libraryWorkspace.name}</span>
            </p>
          )}
        </div>

        {/* Volume Summary */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Flame className="w-3 h-3 text-orange-400" /> Volume
            </h3>
            <span className="text-[10px] font-mono font-semibold text-primary">{volumeData.totalWorkingSets} sets/wk</span>
          </div>
          <div className="space-y-1">
            {volumeData.muscleDistribution.slice(0, 5).map((m) => (
              <div key={m.muscle} className="space-y-0.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="capitalize text-foreground">{m.muscle}</span>
                  <span className="font-mono text-muted-foreground">{m.sets}s ({m.percentage}%)</span>
                </div>
                <div className="w-full h-1 rounded-full bg-secondary/80 overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${m.percentage}%` }} />
                </div>
              </div>
            ))}
            {volumeData.muscleDistribution.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-2">Add exercises to see muscle distribution</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 px-4 py-3 border-t border-border/60 space-y-2">
        {error && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 flex items-center justify-between gap-1">
            <span className="truncate">{error}</span>
            <button type="button" onClick={() => setError('')} className="shrink-0 text-red-400 hover:text-red-300">×</button>
          </div>
        )}
        {successMessage && (
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3 shrink-0" />
            <span className="truncate">{successMessage}</span>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Button
            variant="secondary"
            onClick={() => { setTemplateName(name ? `${name} (Template)` : 'New Workout Template'); setTemplateModalOpen(true); }}
            className="w-full text-[11px] h-8"
          >
            <Bookmark className="w-3 h-3 text-purple-400" /> Save as Template
          </Button>
          <Button
            onClick={planId ? handleSaveChanges : handleSaveAndAssign}
            disabled={saving}
            className="w-full text-[11px] h-8"
          >
            <Users className="w-3 h-3" /> {saving ? 'Saving…' : (planId ? 'Save Changes' : 'Save & Assign')}
          </Button>
          <div className="flex justify-center">
            <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Column content: Embedded header (embedded mode action bar) ─────
  const embeddedHeaderContent = (
    <div className="px-4 py-3 border-b border-border/60 bg-card/60 shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge className={cn('text-[9px] font-mono capitalize shrink-0', isTemplate ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-secondary text-muted-foreground border-border')}>
              {isTemplate ? 'Template' : 'Client Plan'}
            </Badge>
            {selectedClient && (
              <Badge className="text-[9px] font-mono bg-primary/10 text-primary border-primary/20 shrink-0 truncate max-w-[100px]">
                {selectedClient.full_name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan Name"
              className="text-[13px] font-bold text-foreground bg-transparent border-b border-transparent focus:border-border/80 focus:outline-none px-0 py-0.5 min-w-0 flex-1"
            />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <select
              value={splitType}
              onChange={(e) => {
                const newSplit = e.target.value;
                setSplitType(newSplit);
                if (newSplit === 'custom') {
                  const customName = customSplitName || 'Session 1';
                  setDays((prev) => prev.map((d, idx) => ({ ...d, day_name: idx === 0 ? customName : d.day_name })));
                }
              }}
              className="h-6 px-1.5 rounded-md bg-secondary/40 border border-border/60 text-[10px] text-muted-foreground focus:outline-none focus:border-primary/40"
            >
              {SPLIT_TYPES.map((st) => (
                <option key={st.id} value={st.id}>{st.label}</option>
              ))}
            </select>
            {splitType === 'custom' && (
              <input
                type="text"
                placeholder="Split name"
                value={customSplitName}
                onChange={(e) => {
                  setCustomSplitName(e.target.value);
                  if (days.length === 1) handleUpdateDay(0, { day_name: e.target.value || 'Session 1' });
                }}
                className="h-6 px-2 rounded-md bg-secondary/40 border border-border/60 text-[10px] text-muted-foreground focus:outline-none focus:border-primary/40 min-w-0 flex-1"
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
          <Button
            variant="secondary"
            onClick={() => { setTemplateName(name ? `${name} (Template)` : 'New Workout Template'); setTemplateModalOpen(true); }}
            className="text-[10px] h-7 px-2"
          >
            <Bookmark className="w-3 h-3 text-purple-400" />
          </Button>
          <Button
            onClick={planId ? handleSaveChanges : handleSaveAndAssign}
            disabled={saving}
            className="text-[10px] h-7 px-2.5"
          >
            <Users className="w-3 h-3" /> {saving ? '…' : (planId ? 'Save' : 'Assign')}
          </Button>
          {onExit && (
            <button
              type="button"
              onClick={async () => { await autosave.flush(); onExit?.(); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Close plan"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {(error || successMessage) && (
        <div className="mt-2">
          {error && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 flex items-center justify-between gap-1">
              <span className="truncate">{error}</span>
              <button type="button" onClick={() => setError('')} className="shrink-0">×</button>
            </div>
          )}
          {successMessage && (
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3 shrink-0" />
              <span className="truncate">{successMessage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── Column content: Day Master List ───────────────────────────────
  const dayMasterListContent = (
    <div className="flex flex-col h-full">
      {/* Day list header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Training Days</h2>
          <span className="text-[10px] font-mono text-muted-foreground">{days.length} days</span>
        </div>
        {notes && (
          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">{notes}</p>
        )}
      </div>

      {/* Scrollable day list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <DragDropContext onDragEnd={handleDayDragEnd}>
          <Droppable droppableId="day-master-list" direction="vertical">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-1.5"
              >
                {days.map((d, dIdx) => {
                  const isRest = d.day_type === 'rest_day' || !!d.rest_day;
                  const isActive = activeDayIndex === dIdx;
                  const sv = volumeData.sessionVolumes[dIdx];
                  const exCount = sv?.totalExercises ?? (d.exercises?.length ?? 0);
                  const workingSets = sv?.workingSets ?? 0;

                  return (
                    <Draggable key={d.id || `day-${dIdx}`} draggableId={d.id || `day-${dIdx}`} index={dIdx}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={cn(
                            'group relative rounded-xl border select-none transition-colors duration-150 ease-out',
                            isActive
                              ? isRest
                                ? 'bg-card border-amber-500/40 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-amber-400 before:rounded-r'
                                : 'bg-card border-primary/50 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-primary before:rounded-r'
                              : isRest
                                ? 'bg-card/40 border-amber-500/20 hover:border-amber-500/40 hover:bg-card'
                                : 'bg-card/40 border-border/40 hover:border-border/80 hover:bg-card',
                            dragSnapshot.isDragging && 'shadow-xl ring-1 ring-primary/40 opacity-95 z-50 bg-card'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDayIndex(dIdx);
                              setMobileStep(3);
                            }}
                            className="w-full text-left p-3 pr-10 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded-xl"
                            aria-label={`Select day ${dIdx + 1}: ${d.day_name || 'Unnamed'}`}
                            aria-pressed={isActive}
                          >
                            <div className="flex items-start gap-2.5">
                              {/* Day number */}
                              <div className={cn(
                                'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold font-mono mt-0.5',
                                isActive
                                  ? isRest ? 'bg-amber-500/20 text-amber-300' : 'bg-primary/20 text-primary'
                                  : isRest ? 'bg-amber-500/10 text-amber-400/70' : 'bg-secondary/60 text-muted-foreground'
                              )}>
                                {dIdx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                {/* Day name + type badge */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={cn(
                                    'text-[13px] font-semibold truncate',
                                    isActive
                                      ? isRest ? 'text-amber-200' : 'text-foreground'
                                      : isRest ? 'text-amber-400/80' : 'text-foreground/85 group-hover:text-foreground'
                                  )}>
                                    {d.day_name || `Day ${dIdx + 1}`}
                                  </span>
                                  {isRest && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400/90 border border-amber-500/20">
                                      <BedDouble className="w-2.5 h-2.5" /> REST
                                    </span>
                                  )}
                                </div>
                                {/* Summary line */}
                                <p className={cn(
                                  'text-[11px] mt-0.5 font-medium',
                                  isActive ? 'text-muted-foreground' : 'text-muted-foreground/70'
                                )}>
                                  {isRest ? (
                                    <span className="text-amber-500/70 font-mono text-[10px]">Recovery</span>
                                  ) : (
                                    <span>
                                      {exCount > 0 ? (
                                        <>{exCount} exercise{exCount !== 1 ? 's' : ''} · <span className={cn('font-mono', isActive ? 'text-primary' : 'text-primary/70')}>{workingSets} sets</span></>
                                      ) : (
                                        <span className="text-muted-foreground/40 text-[10px]">No exercises</span>
                                      )}
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          </button>

                          {/* Right-side controls: drag handle + actions */}
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                            {/* Day actions dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn(
                                    'p-1 rounded-md transition-opacity opacity-45 group-hover:opacity-100',
                                    isActive ? 'opacity-75 hover:opacity-100' : '',
                                    'hover:bg-secondary text-muted-foreground hover:text-foreground'
                                  )}
                                  title="Day options"
                                  aria-label="Day options"
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
                            {/* Drag handle */}
                            <div
                              {...dragProvided.dragHandleProps}
                              className={cn(
                                'p-1 rounded-md cursor-grab active:cursor-grabbing transition-opacity opacity-45 group-hover:opacity-100',
                                'text-muted-foreground hover:text-foreground hover:bg-secondary'
                              )}
                              title="Drag to reorder"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </div>
                          </div>
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
      </div>

      {/* Add day controls — pinned at bottom */}
      <div className="shrink-0 px-3 py-3 border-t border-border/60 flex items-center gap-1.5">
        <Button
          variant="secondary"
          onClick={handleAddDay}
          className="flex-1 text-[11px] h-8"
        >
          <Plus className="w-3.5 h-3.5" /> Add Session
        </Button>
        <Button
          variant="secondary"
          onClick={handleOpenAddRestDay}
          className="flex-1 text-[11px] h-8 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
        >
          <BedDouble className="w-3.5 h-3.5" /> + Rest
        </Button>
      </div>
    </div>
  );

  // ─── Column content: Exercise Editor Panel ─────────────────────────
  const exerciseEditorContent = activeDay ? (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className={cn(
        'px-4 pt-4 pb-3 border-b border-border/40 shrink-0',
        (activeDay.day_type === 'rest_day' || !!activeDay.rest_day) ? 'bg-amber-500/4' : ''
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {(activeDay.day_type === 'rest_day' || !!activeDay.rest_day) ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <BedDouble className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 font-mono">Recovery Day</span>
                </div>
                <input
                  type="text"
                  value={activeDay.day_name || 'Rest Day'}
                  onChange={(e) => handleUpdateDay(activeDayIndex, { day_name: e.target.value })}
                  className="text-[13px] font-semibold text-amber-200 bg-transparent border-b border-transparent hover:border-amber-500/40 focus:border-amber-500 focus:outline-none px-0 py-0.5 w-full transition-colors"
                  placeholder="Rest Day Title"
                />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                    Day {activeDayIndex + 1} · {volumeData.sessionVolumes[activeDayIndex]?.workingSets ?? 0} working sets
                  </span>
                </div>
                <input
                  type="text"
                  value={activeDay.day_name}
                  onChange={(e) => handleUpdateDay(activeDayIndex, { day_name: e.target.value })}
                  className="text-[13px] font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border/60 focus:border-primary/80 focus:outline-none px-0 py-0.5 w-full transition-colors"
                  placeholder="Session Name"
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDuplicateDay(activeDayIndex)}
              className="text-[10px] h-7 px-2 rounded-lg"
              title="Duplicate day"
            >
              <Copy className="w-3 h-3" />
            </Button>
            {days.length > 1 && (
              <button
                type="button"
                onClick={() => handleDeleteDay(activeDayIndex)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Delete day"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setActiveDayIndex(null);
                setMobileStep(2);
              }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-0.5"
              title="Close exercise editor"
              aria-label="Close exercise editor"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Session coaching notes */}
        <div className="mt-2.5">
          <input
            type="text"
            placeholder={(activeDay.day_type === 'rest_day' || !!activeDay.rest_day) ? 'Recovery instructions…' : 'Session coaching notes…'}
            value={activeDay.notes || ''}
            onChange={(e) => handleUpdateDay(activeDayIndex, { notes: e.target.value })}
            className="w-full h-8 px-2.5 rounded-lg bg-secondary/30 border border-border/40 text-[11px] text-muted-foreground placeholder:text-muted-foreground/40 focus:text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
          />
        </div>
      </div>

      {/* Exercise editor body */}
      {(activeDay.day_type === 'rest_day' || !!activeDay.rest_day) ? (
        /* Rest day view */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
              <BedDouble className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-200">{activeDay.day_name || 'Rest Day'}</p>
              <p className="text-[11px] text-amber-400/70 mt-1">Scheduled recovery — no exercises</p>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Coffee className="w-3.5 h-3.5 text-amber-400" /> Recovery Instructions
            </label>
            <textarea
              rows={6}
              value={activeDay.notes || ''}
              onChange={(e) => handleUpdateDay(activeDayIndex, { notes: e.target.value })}
              placeholder={'Keep activity light today.\n8–10k steps.\nStay hydrated.\nNo resistance training.'}
              className="w-full p-3.5 rounded-xl bg-secondary/30 border border-border/40 text-xs focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 text-foreground leading-relaxed resize-none transition-colors"
            />
          </div>
          <div className="p-3.5 rounded-xl bg-secondary/20 border border-border/30 text-xs space-y-1 text-muted-foreground">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-amber-400" /> Scheduled Recovery Item
            </div>
            <p className="text-[11px] leading-relaxed">
              Rest days are positioned in your training split sequence. Recovery instructions are shown directly to the client.
            </p>
          </div>
        </div>
      ) : (
        /* Training session exercises */
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-2">
            {(activeDay.exercises || []).length === 0 ? (
              <div className="py-12 text-center space-y-3 border border-dashed border-border/40 rounded-xl bg-secondary/10">
                <Dumbbell className="w-8 h-8 mx-auto text-muted-foreground/30" />
                <div>
                  <p className="text-xs font-semibold text-foreground">No exercises yet</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Add exercises from the library or create custom movements.</p>
                </div>
                <Button onClick={() => setSearchModalOpen(true)} className="text-xs shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> Add First Exercise
                </Button>
              </div>
            ) : (
              <DragDropContext onDragEnd={handleExerciseDragEnd}>
                <Droppable droppableId="exercises">
                  {(dropProvided) => (
                    <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-2">
                      {(activeDay.exercises || []).map((ex, exIdx) => (
                        <Draggable key={ex.id || `ex-${exIdx}`} draggableId={ex.id || `ex-${exIdx}`} index={exIdx}>
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(
                                'group rounded-xl border select-none transition-colors duration-150',
                                snapshot.isDragging
                                  ? 'border-primary/60 bg-card shadow-xl ring-1 ring-primary/30 opacity-95'
                                  : 'border-border/40 bg-card/50 hover:border-border/70 hover:bg-card'
                              )}
                            >
                              {/* Exercise top row */}
                              <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-1">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  {/* Drag handle */}
                                  <div
                                    {...dragProvided.dragHandleProps}
                                    className={cn(
                                      'w-5 h-5 mt-0.5 rounded flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing transition-opacity',
                                      snapshot.isDragging
                                        ? 'bg-primary/20 border border-primary/30 text-primary opacity-100'
                                        : 'bg-secondary/40 border border-border/40 text-muted-foreground hover:text-foreground opacity-45 group-hover:opacity-100'
                                    )}
                                    title="Drag to reorder"
                                  >
                                    <GripVertical className="w-3 h-3" />
                                  </div>
                                  {/* Exercise identity */}
                                  <div className="space-y-0.5 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-mono text-muted-foreground font-semibold">#{exIdx + 1}</span>
                                      <h4 className="text-[13px] font-semibold text-foreground truncate">{ex.exercise_name}</h4>
                                      {ex._versionInfo && ex._versionInfo.linked === false && (
                                        <span className="inline-flex items-center text-[9px] font-semibold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                                          Not Linked
                                        </span>
                                      )}
                                      <Badge variant="outline" className="text-[9px] uppercase font-mono py-0 px-1.5 rounded-md bg-secondary/60 text-muted-foreground border-border/40">
                                        {ex.category || 'general'}
                                      </Badge>
                                      {/* Computed Total Badge */}
                                      <Badge variant="outline" className="text-[10px] font-mono py-0 px-1.5 rounded-md bg-secondary/40 text-muted-foreground border-border/40">
                                        {(Number(ex.warmup_sets) || 0) + (Number(ex.working_sets) || 0)} total sets
                                      </Badge>
                                    </div>
                                    {ex.equipment && (
                                      <span className="text-[11px] text-muted-foreground font-medium">{ex.equipment}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Exercise actions */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {ex.video_url && (
                                    <button
                                      type="button"
                                      onClick={() => { setActiveVideoExercise(ex); setVideoModalOpen(true); }}
                                      className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                                      title="Watch Demo"
                                    >
                                      <Video className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleReplaceExercise(exIdx)}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                    title="Replace"
                                  >
                                    <ArrowLeftRight className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Secondary actions dropdown */}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                        title="More actions"
                                      >
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContentCmp align="end" className="w-40">
                                      <DropdownMenuItemCmp onClick={() => handleDuplicateExercise(exIdx)}>
                                        <Copy className="w-3.5 h-3.5 mr-2 text-primary" /> Duplicate
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuItemCmp
                                        onClick={() => handleMoveExercise(exIdx, -1)}
                                        disabled={exIdx === 0}
                                        className="disabled:opacity-40"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Move Up
                                      </DropdownMenuItemCmp>
                                      <DropdownMenuItemCmp
                                        onClick={() => handleMoveExercise(exIdx, 1)}
                                        disabled={exIdx === (activeDay.exercises.length - 1)}
                                        className="disabled:opacity-40"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Move Down
                                      </DropdownMenuItemCmp>
                                      {isPlatformAdmin(user) && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItemCmp onClick={() => setVersionLinkExercise({ id: ex.exercise_id, name: ex.exercise_name })}>
                                            <Link2 className="w-3.5 h-3.5 mr-2 text-primary" /> Link Versions
                                          </DropdownMenuItemCmp>
                                        </>
                                      )}
                                    </DropdownMenuContentCmp>
                                  </DropdownMenu>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteExercise(exIdx)}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Remove"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* 5-Column Prescription Grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-3.5 pb-2 pt-1">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground block">Warm-up Sets</label>
                                  <input
                                    type="number" min="0" max="10"
                                    value={ex.warmup_sets ?? 0}
                                    onChange={(e) => handleUpdateExercise(exIdx, { warmup_sets: parseInt(e.target.value, 10) || 0 })}
                                    className="w-full h-8 px-2.5 rounded-lg bg-secondary/50 border border-border/40 text-[12px] font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground block">Work Sets</label>
                                  <input
                                    type="number" min="0" max="30"
                                    value={ex.working_sets ?? 3}
                                    onChange={(e) => handleUpdateExercise(exIdx, { working_sets: parseInt(e.target.value, 10) || 0 })}
                                    className="w-full h-8 px-2.5 rounded-lg bg-secondary/50 border border-border/40 text-[12px] font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground block">Reps</label>
                                  <input
                                    type="text"
                                    placeholder="8-12"
                                    value={ex.rep_range}
                                    onChange={(e) => handleUpdateExercise(exIdx, { rep_range: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded-lg bg-secondary/50 border border-border/40 text-[12px] font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground block">RIR</label>
                                  <input
                                    type="number" min="0" max="10" step="0.5"
                                    value={ex.rpe || ''}
                                    onChange={(e) => handleUpdateExercise(exIdx, { rpe: e.target.value })}
                                    placeholder="1"
                                    className="w-full h-8 px-2.5 rounded-lg bg-secondary/50 border border-border/40 text-[12px] font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
                                  />
                                </div>
                                <div className="space-y-1 col-span-2 sm:col-span-1">
                                  <label className="text-[10px] font-medium text-muted-foreground block">Rest (s)</label>
                                  <input
                                    type="number" step="15" min="0"
                                    value={ex.rest_seconds || 60}
                                    onChange={(e) => handleUpdateExercise(exIdx, { rest_seconds: e.target.value })}
                                    className="w-full h-8 px-2.5 rounded-lg bg-secondary/50 border border-border/40 text-[12px] font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors"
                                  />
                                </div>
                              </div>

                              {/* Notes */}
                              <div className="px-3.5 pb-3">
                                <textarea
                                  rows={2}
                                  placeholder="Technique note (e.g. Slow 3s eccentric, full stretch)…"
                                  value={ex.notes || ''}
                                  onChange={(e) => handleUpdateExercise(exIdx, { notes: e.target.value })}
                                  className="w-full min-h-[42px] py-1.5 px-2.5 rounded-lg bg-secondary/30 border border-border/40 text-[11px] text-muted-foreground placeholder:text-muted-foreground/40 focus:text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors resize-none"
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
          </div>
        </div>
      )}

      {/* Add exercise footer — only for sessions */}
      {selectedDayIsSession && (
        <div className="shrink-0 px-4 py-3 border-t border-border/60">
          <Button
            variant="secondary"
            onClick={() => { setReplaceIndex(null); setSearchModalOpen(true); }}
            className="w-full text-[11px] h-8 border border-dashed border-border hover:border-primary/50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Exercise to {activeDay.day_name || `Day ${activeDayIndex + 1}`}
          </Button>
        </div>
      )}
    </div>
  ) : (
    /* No day selected empty state */
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16 space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-secondary/60 border border-border/60 flex items-center justify-center">
        <Dumbbell className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">Select a Training Day</p>
        <p className="text-[12px] text-muted-foreground mt-1">Choose a day from the list to edit its exercises</p>
      </div>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className={cn(
      embedded
        ? 'flex flex-col h-full overflow-hidden'
        : 'flex flex-col h-[calc(100vh-56px)] overflow-hidden'
    )}>
      {/* Standalone-only: back button + top bar */}
      {!embedded && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-card/80 shrink-0">
          <button
            type="button"
            onClick={async () => { await autosave.flush(); navigate(returnTo || '/workouts'); }}
            className="p-1.5 rounded-lg bg-secondary/50 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Back to Workout Plans"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary font-mono">
            {isTemplate ? 'Template Builder' : 'Workout Plan Builder'}
          </span>
          <div className="flex items-center gap-2">
            <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
            <Button
              variant="secondary"
              onClick={() => { setTemplateName(name ? `${name} (Template)` : 'New Workout Template'); setTemplateModalOpen(true); }}
              className="text-[11px] h-8"
            >
              <Bookmark className="w-3.5 h-3.5 text-purple-400" /> Template
            </Button>
            <Button
              onClick={planId ? handleSaveChanges : handleSaveAndAssign}
              disabled={saving}
              className="text-[11px] h-8"
            >
              <Users className="w-3.5 h-3.5" /> {saving ? 'Saving…' : (planId ? 'Save Changes' : 'Save & Assign')}
            </Button>
          </div>
        </div>
      )}

      {/* Alerts */}
      {!embedded && (error || successMessage) && (
        <div className="px-4 py-2 shrink-0 space-y-1">
          {error && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-400 flex items-center justify-between gap-2">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300">×</button>
            </div>
          )}
          {successMessage && (
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400 flex items-center gap-2">
              <Check className="w-3.5 h-3.5" /> {successMessage}
            </div>
          )}
        </div>
      )}

      {/* 3-column layout (ONE unified top-level PanelGroup) */}
      <div className="flex-1 overflow-hidden">
        {/* Desktop: 3 resizable panels */}
        <div className="hidden md:flex h-full">
          <PanelGroup
            direction="horizontal"
            autoSaveId={sidebarSlot ? "ybs-client-3col-planner" : "ybs-standalone-planner"}
            className="h-full"
          >
            {/* Col 1: Sidebar (either client's programs sidebarSlot or standalone configSidebarContent) */}
            <Panel
              id="planner-col1"
              order={1}
              defaultSize={24}
              minSize={18}
              maxSize={32}
              className="flex flex-col overflow-hidden border-r border-border/40"
            >
              <div className="flex-1 overflow-y-auto h-full">
                {sidebarSlot || configSidebarContent}
              </div>
            </Panel>

            <PlannerResizeHandle id="planner-gutter-1-2" />

            {/* Col 2: Day list (with embeddedHeaderContent at top if embedded) */}
            <Panel
              id="planner-col2"
              order={2}
              defaultSize={showExercisePanel ? 28 : 76}
              minSize={22}
              className="flex flex-col overflow-hidden"
            >
              <div className="flex-1 flex flex-col overflow-hidden h-full">
                {embedded && embeddedHeaderContent}
                <div className="flex-1 overflow-y-auto">
                  {dayMasterListContent}
                </div>
              </div>
            </Panel>

            {/* Col 3: Exercise editor (only when a day is selected) */}
            {showExercisePanel && (
              <>
                <PlannerResizeHandle id="planner-gutter-2-3" />
                <Panel
                  id="planner-col3"
                  order={3}
                  defaultSize={48}
                  minSize={28}
                  className="flex flex-col overflow-hidden border-l border-border/40"
                >
                  <div className="flex-1 overflow-y-auto h-full animate-in fade-in-50 duration-200 slide-in-from-right-1">
                    {exerciseEditorContent}
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>

        {/* Mobile: 3-step progressive navigation */}
        <div className="md:hidden h-full overflow-y-auto">
          {mobileStep === 1 && (
            <div className="h-full">
              {sidebarSlot || configSidebarContent}
            </div>
          )}

          {mobileStep === 2 && (
            <div className="h-full flex flex-col">
              {sidebarSlot && (
                <button
                  type="button"
                  onClick={() => setMobileStep(1)}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-3 border-b border-border/40 shrink-0 text-left bg-card/40"
                >
                  ← Programs
                </button>
              )}
              <div className="flex-1 overflow-y-auto">
                {embedded && embeddedHeaderContent}
                {dayMasterListContent}
              </div>
            </div>
          )}

          {mobileStep === 3 && (
            <div className="h-full flex flex-col">
              <button
                type="button"
                onClick={() => setMobileStep(2)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-3 border-b border-border/40 shrink-0 text-left bg-card/40"
              >
                ← Day List
              </button>
              <div className="flex-1 overflow-y-auto animate-in fade-in-50 duration-200">
                {exerciseEditorContent}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── All modals (unchanged) ─── */}

      {/* 1. Exercise Search Modal */}
      <ExerciseSearchModal
        open={searchModalOpen}
        onClose={() => { setReplaceIndex(null); setSearchModalOpen(false); }}
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
          onClose={() => { setVideoModalOpen(false); setActiveVideoExercise(null); }}
          exerciseName={activeVideoExercise.exercise_name}
          videoUrl={activeVideoExercise.video_url}
          instructions={activeVideoExercise.notes}
        />
      )}

      {/* 2b. Exercise Version Linking (platform owner) */}
      {isPlatformAdmin(user) && (
        <ExerciseVersionLinkModal
          open={!!versionLinkExercise}
          onClose={() => setVersionLinkExercise(null)}
          initialSourceExerciseId={versionLinkExercise?.id}
        />
      )}

      {/* 3. Save as Template Modal */}
      <Modal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} title="Save as Reusable Template" size="md">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Save this program structure as a reusable workout template. Templates can be cloned and assigned to any client without mutating the original.
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
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)} className="text-xs">Cancel</Button>
            <Button onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()} className="text-xs">
              {savingTemplate ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 4. Client Assignment Modal */}
      <Modal open={clientPickerOpen} onClose={() => setClientPickerOpen(false)} title="Assign Workout Plan to Client" size="md">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Assign this workout plan to a client. This creates an independent snapshot instance so subsequent template edits will not affect active client programming.
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
                  disabled={saving}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-secondary/60 flex items-center justify-between text-xs transition-colors group disabled:opacity-50 disabled:pointer-events-none"
                >
                  <div>
                    <span className="font-semibold text-foreground block group-hover:text-primary transition-colors">{c.full_name}</span>
                    {c.client_code && <span className="text-[10px] font-mono text-muted-foreground">Code: {c.client_code}</span>}
                  </div>
                  <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">Assign →</span>
                </button>
              ))}
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setClientPickerOpen(false)} className="text-xs">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* 5. Exercise Library Source Modal */}
      <Modal open={librarySourceOpen} onClose={() => setLibrarySourceOpen(false)} title="Exercise Library Source" size="md">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose which workspace's exercise library this plan browses. Exercises already added are kept unchanged.
          </p>
          {workspaces.length === 0 ? (
            <p className="text-xs text-muted-foreground">No workspaces available.</p>
          ) : (
            <div className="space-y-2">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => { setExerciseLibraryWorkspaceId(w.id); setLibrarySourceOpen(false); }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all',
                    exerciseLibraryWorkspaceId === w.id
                      ? 'bg-primary/10 border-primary/50 text-foreground'
                      : 'bg-secondary/40 border-border/60 text-foreground hover:bg-secondary'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{w.name}</span>
                    {exerciseLibraryWorkspaceId === w.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{w.id}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setLibrarySourceOpen(false)} className="text-xs">Cancel</Button>
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
              placeholder={"Keep activity light today.\n8–10k steps.\nStay hydrated.\nNo resistance training."}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button type="button" variant="secondary" onClick={() => setRestDayModalOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" className="text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold">
              <Check className="w-3.5 h-3.5" /> {restDayEditIndex !== null ? 'Save Instructions' : 'Save Rest Day'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 7. Rename Session Modal */}
      <Modal open={renameModalOpen} onClose={() => setRenameModalOpen(false)} title="Rename Session" size="sm">
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
            <Button type="button" variant="secondary" onClick={() => setRenameModalOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" className="text-xs">
              <Check className="w-3.5 h-3.5" /> Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* 8. Delete Session Confirmation Dialog */}
      <AlertDialog open={dayToDeleteIndex !== null} onOpenChange={(open) => !open && setDayToDeleteIndex(null)}>
        <AlertDialogContent className="max-w-md bg-card border border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-sm font-semibold">
              Delete {days[dayToDeleteIndex]?.day_type === 'rest_day' || days[dayToDeleteIndex]?.rest_day ? 'Rest Day' : 'Session'}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs leading-relaxed">
              Are you sure you want to delete &ldquo;{days[dayToDeleteIndex]?.day_name || `Day ${dayToDeleteIndex + 1}`}&rdquo;? All assigned exercises in this session will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDeleteDay}
              className="text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 9. Remove Exercise Confirmation Dialog */}
      <AlertDialog open={exerciseToDeleteIndex !== null} onOpenChange={(open) => !open && setExerciseToDeleteIndex(null)}>
        <AlertDialogContent className="max-w-md bg-card border border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-sm font-semibold">
              Remove Exercise?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs leading-relaxed">
              Are you sure you want to remove &ldquo;{activeDay?.exercises?.[exerciseToDeleteIndex]?.exercise_name}&rdquo; from this session?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDeleteExercise}
              className="text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

