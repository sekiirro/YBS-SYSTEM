import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { PanelGroup, Panel } from 'react-resizable-panels';
import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId } from '@/lib/ybs-auth';
import { NutritionService, calculatePlanTotals } from '@/services/nutrition';
import { calculateFoodNutrients } from '@/lib/nutritionUnits';
import { ClientsService } from '@/services/clients';
import { LoadingState, Button, Badge, Modal } from '@/components/ui';
import { PlannerResizeHandle } from '@/components/workouts/PremiumPlannerLayout';
import NutritionMacroSummary from '@/components/nutrition/NutritionMacroSummary';
import NutritionItemRow from '@/components/nutrition/NutritionItemRow';
import FoodPickerModal from '@/components/nutrition/FoodPickerModal';
import BulkFoodPickerModal from '@/components/nutrition/BulkFoodPickerModal';
import ReplaceFoodModal from '@/components/nutrition/ReplaceFoodModal';
import SaveStatus from '@/components/SaveStatus';
import useAutosave from '@/hooks/useAutosave';
import { toast } from '@/components/ui/use-toast';
import {
  ArrowLeft,
  Save,
  Bookmark,
  Plus,
  Users,
  Search,
  Check,
  AlertCircle,
  GripVertical,
  Utensils,
  StickyNote,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Copy,
  X,
  Apple,
  Clock,
  Sparkles,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SUGGESTED_MEAL_NAMES = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Pre-workout',
  'Post-workout',
  'Snack',
  'Snack 1',
  'Snack 2',
];

function fmtAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '0';
}

/**
 * Deterministic duplicate-meal naming: strips a trailing numeric suffix so
 * repeated duplication keeps auto-incrementing ("Breakfast" → "Breakfast 2" →
 * "Breakfast 3"), regardless of the source meal's own suffix.
 */
function nextDuplicateMealName(sourceName, existingNames) {
  const used = new Set(
    (existingNames || [])
      .filter(Boolean)
      .map((n) => String(n).trim().toLowerCase())
  );
  let base = String(sourceName || 'Meal').trim();
  if (!base) base = 'Meal';

  const suffixMatch = base.match(/^(.*?)[\s]+(\d+)$/);
  if (suffixMatch) base = suffixMatch[1].trim();
  if (!base) base = 'Meal';

  let n = 2;
  let candidate = `${base} ${n}`;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} ${n}`;
  }
  return candidate;
}

/**
 * Calculates sum of calories and macros for an individual meal.
 */
function calculateSingleMealTotals(meal) {
  const items = meal?.items || meal?.nutrition_items || [];
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  for (const it of items) {
    calories += Number(it.calories) || 0;
    protein += Number(it.protein) || 0;
    carbs += Number(it.carbs) || 0;
    fat += Number(it.fat) || 0;
  }
  return {
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
  };
}

export default function NutritionPlanBuilder(props = {}) {
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
  // CLIENT id — it must never be mistaken for a nutrition plan id. Only the
  // standalone /nutrition/builder/:id route carries a plan id in the URL.
  const id = propPlanId || (!embedded ? routeId : undefined);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Plan Meta State
  const [planId, setPlanId] = useState(propPlanId || id || null);
  const [isTemplate, setIsTemplate] = useState(false);
  const [status, setStatus] = useState('draft');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  // Meals State (each meal contains items[])
  const [meals, setMeals] = useState([]);

  // Active Selected Meal for Column 3 Deep Editor
  const [selectedMealIndex, setSelectedMealIndex] = useState(null);

  // Deep Editor Food Pickers & Replacement State
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState(null); // { mealIndex, itemIndex, item }

  // Client Picker State (standalone mode)
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState([]);

  // Template Save Modal State
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Plan Notes expansion in Column 2
  const [showNotesEditor, setShowNotesEditor] = useState(false);

  // Mobile navigation: 1 = sidebar/plans, 2 = plan overview & meals, 3 = meal deep editor
  const [mobileStep, setMobileStep] = useState(embedded ? 2 : 2);

  // Server baseline for autosave (serialized state as loaded from the DB).
  const [serverSnapshot, setServerSnapshot] = useState(null);
  // Baseline for a brand-new (never-saved) draft, captured at load time so
  // autosave only creates the row after a real edit (never on mount).
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // Tracks the live plan id synchronously so the manual save path can never
  // create a second row while an autosave-created draft is settling.
  const planIdRef = useRef(planId);
  useEffect(() => { planIdRef.current = planId; }, [planId]);

  // ── 1. Load Initial Data ──
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');

        let clientList = [];

        if (id) {
          // Editing existing plan
          try {
            clientList = (await ClientsService.list({})) || [];
          } catch {
            clientList = [];
          }
          if (isMounted) setClients(clientList);

          const plan = await NutritionService.getById(id);
          if (isMounted && plan) {
            setPlanId(plan.id);
            setName(plan.name || '');
            setNotes(plan.notes || '');
            setIsTemplate(!!plan.is_template);
            setStatus(plan.status || (plan.is_template ? 'active' : 'draft'));
            if (plan.client_id) {
              const matched = clientList.find((c) => c.id === plan.client_id);
              setSelectedClient(matched || { id: plan.client_id, full_name: plan.client_name });
            }
            const loadedMeals = plan.meals || [];
            setMeals(loadedMeals);
            if (isMounted) {
              setServerSnapshot(JSON.stringify([plan.name || '', plan.notes || '', loadedMeals]));
              setInitialized(true);
            }
          } else if (isMounted) {
            setError('Failed to load plan details');
            setLoading(false);
            return;
          }
        } else if (templateId) {
          // Pre-filling builder from a template (deep copy without saving to DB)
          const tpl = await NutritionService.getById(templateId);
          if (isMounted && tpl) {
            setPlanId(null);
            setName(`${tpl.name} (Copy)`);
            setNotes(tpl.notes || '');
            setIsTemplate(false);
            setStatus('draft');

            const copiedMeals = (tpl.meals || []).map((m, mIdx) => ({
              id: `copied-meal-${mIdx}-${Date.now()}`,
              meal_name: m.meal_name,
              notes: m.notes || null,
              sort_order: mIdx,
              day_number: m.day_number || 1,
              items: (m.items || []).map((it, itIdx) => ({
                id: `copied-item-${itIdx}-${Date.now()}`,
                food_id: it.food_id,
                food_name: it.food_name,
                brand: it.brand || null,
                amount: it.amount,
                unit: it.unit,
                calories: it.calories,
                protein: it.protein,
                carbs: it.carbs,
                fat: it.fat,
                base_food: it.base_food || it.foods || null,
              })),
            }));
            setMeals(copiedMeals);

            if (queryClientId) {
              const matched = clientList.find((c) => c.id === queryClientId);
              setSelectedClient(matched || (queryClientName ? { id: queryClientId, full_name: queryClientName } : null));
            }
            if (isMounted) {
              setInitialSnapshot(JSON.stringify([`${tpl.name} (Copy)`, tpl.notes || '', copiedMeals]));
              setInitialized(true);
            }
          }
        } else {
          // New Blank Plan
          try {
            clientList = (await ClientsService.list({})) || [];
          } catch {
            clientList = [];
          }
          if (isMounted) setClients(clientList);
          setName('New Nutrition Plan');
          setIsTemplate(searchParams.get('type') === 'template');
          setStatus(searchParams.get('type') === 'template' ? 'active' : 'draft');
          const defaultMeals = [
            { id: `meal-1-${Date.now()}`, meal_name: 'Breakfast', notes: '', sort_order: 0, day_number: 1, items: [] },
            { id: `meal-2-${Date.now()}`, meal_name: 'Lunch', notes: '', sort_order: 1, day_number: 1, items: [] },
            { id: `meal-3-${Date.now()}`, meal_name: 'Dinner', notes: '', sort_order: 2, day_number: 1, items: [] },
          ];
          setMeals(defaultMeals);

          if (queryClientId) {
            const matched = clientList.find((c) => c.id === queryClientId);
            setSelectedClient(matched || (queryClientName ? { id: queryClientId, full_name: queryClientName } : null));
          }
          if (isMounted) {
            setInitialSnapshot(JSON.stringify(['New Nutrition Plan', '', defaultMeals]));
            setInitialized(true);
          }
        }
      } catch (err) {
        console.error('Error loading builder state:', err);
        if (isMounted) setError('Failed to load plan details');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [id, templateId, queryClientId, queryClientName, searchParams]);

  // ── 2. Live Plan Totals ──
  const planTotals = useMemo(() => calculatePlanTotals(meals), [meals]);

  // ── 2b. Autosave (server-persistent for drafts) ──
  // A brand-new CLIENT draft (opened from a client's page) auto-creates its
  // row on the first real edit, then keeps autosaving in place — so switching
  // Client Detail tabs never loses a draft that was never explicitly saved.
  // Standalone/new-template flows keep the explicit first-save behaviour.
  const canAutoCreate = embedded && !isTemplate && !planId && status === 'draft' && !!selectedClient?.id;
  const autosaveEnabled = initialized && (!!planId || canAutoCreate);
  const autosaveSnapshot = JSON.stringify([name, notes, meals]);
  const autosave = useAutosave({
    id: planId,
    enabled: autosaveEnabled,
    snapshot: autosaveSnapshot,
    lastSavedSnapshot: planId ? serverSnapshot : initialSnapshot,
    create: canAutoCreate ? async () => {
      const created = await NutritionService.create({
        workspace_id: wsId,
        client_id: selectedClient?.id,
        assigned_ybs_coach_id: user?.id,
        name: name.trim() || 'New Nutrition Plan',
        is_template: false,
        notes: notes.trim() || null,
        status: 'draft',
      }, meals);
      return created?.id;
    } : undefined,
    onCreated: (newId, snap) => {
      planIdRef.current = newId;
      setPlanId(newId);
      setServerSnapshot(snap);
      onPlanSaved?.();
    },
    save: async () => {
      await NutritionService.update(planIdRef.current || planId, {
        name: name.trim(),
        notes: notes.trim() || null,
      }, meals);
    },
  });

  // Drain any pending autosave when this builder unmounts (Client Detail tab
  // switch, plan switch, route change) so edits already applied to the UI
  // are never lost. `flush` is referentially stable so this only runs on real
  // unmount, and it is a no-op when there is nothing to persist.
  useEffect(() => () => { void autosave.flush(); }, [autosave.flush]);

  // ── 3. Meal State Modifiers ──
  const handleAddMeal = (customName) => {
    const mealName = customName || `Meal ${meals.length + 1}`;
    const newMeal = {
      id: `meal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      meal_name: mealName,
      notes: '',
      sort_order: meals.length,
      day_number: 1,
      items: [],
    };
    setMeals((prev) => [...prev, newMeal]);
    setSelectedMealIndex(meals.length);
    setMobileStep(3);
  };

  const handleRenameMeal = (index, newName) => {
    setMeals((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], meal_name: newName };
      }
      return next;
    });
  };

  const handleChangeMealNotes = (index, mealNotes) => {
    setMeals((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], notes: mealNotes || '' };
      }
      return next;
    });
  };

  const handleMoveMeal = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= meals.length) return;
    setMeals((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next.map((m, idx) => ({ ...m, sort_order: idx }));
    });
    if (selectedMealIndex === index) {
      setSelectedMealIndex(target);
    } else if (selectedMealIndex === target) {
      setSelectedMealIndex(index);
    }
  };

  const handleDuplicateMeal = (index) => {
    // Name resolution + insertion happen inside the state updater so rapid
    // repeated clicks always see the latest list and keep generating unique
    // sequential names ("Breakfast" → "Breakfast 2" → "Breakfast 3").
    setMeals((prev) => {
      const source = prev[index];
      if (!source) return prev;
      const sourceItems = source.items || source.nutrition_items || [];
      const now = Date.now();

      const newMeal = {
        id: `meal-${now}-${Math.random().toString(36).substring(2, 7)}`,
        meal_name: nextDuplicateMealName(source.meal_name, prev.map((m) => m.meal_name)),
        notes: source.notes || '',
        day_number: source.day_number || 1,
        sort_order: 0,
        items: sourceItems.map((it, itemIdx) => ({
          ...it,
          meal_id: undefined,
          id: `item-${now}-${itemIdx}-${Math.random().toString(36).substring(2, 7)}`,
        })),
      };

      const next = [...prev];
      next.splice(index + 1, 0, newMeal);
      return next.map((m, idx) => ({ ...m, sort_order: idx }));
    });

    // Keep the deep editor focused on the freshly inserted duplicate.
    setSelectedMealIndex(index + 1);
    setMobileStep(3);
    toast({
      title: 'Meal duplicated',
      description: 'A copy of the meal was added after the original.',
    });
  };

  const handleRemoveMeal = (index) => {
    if (meals.length <= 1) {
      if (!window.confirm('Remove this meal? Your plan will have no meals.')) return;
    }
    setMeals((prev) => prev.filter((_, idx) => idx !== index).map((m, idx) => ({ ...m, sort_order: idx })));
    if (selectedMealIndex === index) {
      setSelectedMealIndex(null);
      setMobileStep(2);
    } else if (selectedMealIndex > index) {
      setSelectedMealIndex((prev) => prev - 1);
    }
  };

  const handleAddItemToMeal = (mealIndex, foodItem) => {
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
      if (!targetMeal) return prev;
      const currentItems = targetMeal.items || [];
      next[mealIndex] = {
        ...targetMeal,
        items: [
          ...currentItems,
          {
            id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            ...foodItem,
          },
        ],
      };
      return next;
    });
  };

  const handleAddItemsToMeal = (mealIndex, foodItems = []) => {
    if (foodItems.length === 0) return;
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
      if (!targetMeal) return prev;
      const currentItems = targetMeal.items || [];
      next[mealIndex] = {
        ...targetMeal,
        items: [
          ...currentItems,
          ...foodItems.map((foodItem) => ({
            id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            ...foodItem,
          })),
        ],
      };
      return next;
    });
  };

  const handleUpdateItemAmount = (mealIndex, itemIndex, updatedItem) => {
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
      if (!targetMeal) return prev;
      const currentItems = [...(targetMeal.items || [])];
      currentItems[itemIndex] = updatedItem;
      next[mealIndex] = { ...targetMeal, items: currentItems };
      return next;
    });
  };

  const handleRemoveItemFromMeal = (mealIndex, itemIndex) => {
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
      if (!targetMeal) return prev;
      next[mealIndex] = {
        ...targetMeal,
        items: (targetMeal.items || []).filter((_, idx) => idx !== itemIndex),
      };
      return next;
    });
  };

  // Drag-and-drop guard: block drag initiation from interactive elements
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

  const handleMealDragEnd = (result) => {
    if (!result.destination) return;
    const srcIdx = result.source.index;
    const destIdx = result.destination.index;
    if (srcIdx === destIdx) return;
    setMeals((prev) => {
      const next = [...prev];
      const [moved] = next.splice(srcIdx, 1);
      next.splice(destIdx, 0, moved);
      return next.map((m, idx) => ({ ...m, sort_order: idx }));
    });
    if (selectedMealIndex === srcIdx) {
      setSelectedMealIndex(destIdx);
    } else if (selectedMealIndex !== null) {
      if (srcIdx < selectedMealIndex && destIdx >= selectedMealIndex) {
        setSelectedMealIndex((curr) => curr - 1);
      } else if (srcIdx > selectedMealIndex && destIdx <= selectedMealIndex) {
        setSelectedMealIndex((curr) => curr + 1);
      }
    }
  };

  // ── 4. Save Plan ──
  const handleSave = async () => {
    if (!wsId) {
      setError('No active workspace found. Join or switch to a workspace before saving this plan.');
      return;
    }
    setError('');
    if (!name.trim()) {
      setError('Please provide a plan name.');
      return;
    }
    if (meals.length === 0) {
      setError('Please add at least one meal to the plan.');
      return;
    }

    await autosave.flush();

    try {
      setSaving(true);
      const currentPlanId = planIdRef.current || planId;
      const planPayload = {
        workspace_id: wsId,
        client_id: isTemplate ? null : selectedClient?.id,
        assigned_ybs_coach_id: user?.id,
        name: name.trim(),
        is_template: isTemplate,
        notes: notes.trim() || null,
        status: currentPlanId ? undefined : isTemplate ? 'active' : 'draft',
      };

      if (currentPlanId) {
        await NutritionService.update(currentPlanId, planPayload, meals);
      } else {
        const created = await NutritionService.create(planPayload, meals);
        if (created?.id) {
          planIdRef.current = created.id;
          setPlanId(created.id);
        }
      }

      setSuccessMessage('Plan saved successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      onPlanSaved?.();

      if (!embedded) {
        navigate(returnTo || '/nutrition');
      }
    } catch (err) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save nutrition plan');
    } finally {
      setSaving(false);
    }
  };

  // ── 5. Activate & Assign (draft → active) ──
  const handleActivate = async () => {
    // Drain pending autosave first: an embedded draft's first edit may have
    // auto-created the row which is still settling, and activating must reuse
    // that exact plan id rather than erroring before it exists.
    await autosave.flush();
    const currentPlanId = planIdRef.current || planId;
    if (!currentPlanId) {
      setError('Save the draft first, then activate and assign it.');
      return;
    }
    if (!isTemplate && !selectedClient) {
      setError('Please select a client to assign this plan to.');
      return;
    }
    if (!name.trim()) {
      setError('Please provide a plan name before activating.');
      return;
    }
    if (meals.length === 0) {
      setError('Please add at least one meal before activating.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      const planPayload = {
        workspace_id: wsId,
        client_id: selectedClient?.id,
        assigned_ybs_coach_id: user?.id,
        name: name.trim(),
        is_template: false,
        notes: notes.trim() || null,
      };
      await NutritionService.update(currentPlanId, planPayload, meals);
      await NutritionService.activatePlan(currentPlanId, selectedClient.id);
      setStatus('active');
      setSuccessMessage('Plan activated and assigned to client!');
      setTimeout(() => setSuccessMessage(''), 3000);
      onPlanSaved?.();

      if (!embedded) {
        navigate(returnTo || '/nutrition');
      }
    } catch (err) {
      console.error('Activation failed:', err);
      setError(err.message || 'Failed to activate plan');
    } finally {
      setSaving(false);
    }
  };

  // ── 6. Save as Independent Template ──
  const handleSaveAsTemplate = async () => {
    if (!wsId) {
      setError('No active workspace found. Join or switch to a workspace before saving this plan.');
      return;
    }
    if (!templateName.trim()) return;

    try {
      setSavingTemplate(true);
      const templatePayload = {
        workspace_id: wsId,
        name: templateName.trim(),
        notes: notes.trim() || null,
        assigned_ybs_coach_id: user?.id,
      };

      await NutritionService.saveAsTemplate(templatePayload, meals);
      setTemplateModalOpen(false);
      setTemplateName('');
      toast({
        title: 'Template saved',
        description: 'Nutrition template created successfully.',
      });
    } catch (err) {
      console.error('Template save failed:', err);
      toast({
        title: 'Save failed',
        description: err.message || 'Failed to save template',
        variant: 'destructive',
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  // Apply candidate replacement food from smart modal
  const handleApplyReplacement = async (candidate) => {
    if (!replacementTarget) return;
    const { mealIndex, itemIndex, item: current } = replacementTarget;
    if (!current || !candidate) return;

    const updated = {
      ...current,
      food_id: candidate.food_id,
      food_name: candidate.name,
      brand: candidate.food?.brand || current.brand || null,
      amount: Number(candidate.recommended_amount),
      unit: candidate.recommended_unit || 'g',
      calories: Number(candidate.estimated_calories) || 0,
      protein: Number(candidate.estimated_protein) || 0,
      carbs: Number(candidate.estimated_carbs) || 0,
      fat: Number(candidate.estimated_fat) || 0,
      gram_weight: null,
      base_food: candidate.food || current.base_food || null,
    };

    handleUpdateItemAmount(mealIndex, itemIndex, updated);
    setReplacementTarget(null);
    toast({
      title: 'Food replaced',
      description: `"${current.food_name}" replaced with ${candidate.name} (${fmtAmount(candidate.recommended_amount)} ${candidate.recommended_unit || 'g'}).`,
    });
  };

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.client_code?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const activeMeal = selectedMealIndex !== null ? meals[selectedMealIndex] : null;
  const showMealEditor = !!activeMeal;

  if (loading) return <LoadingState label="Loading Nutrition Plan Builder…" />;

  // ─────────────────────────────────────────────────────────────
  // 1. Column 1 Content (Master Navigation)
  // ─────────────────────────────────────────────────────────────
  const standaloneConfigSidebar = (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-border/40">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">
            Plan Configuration
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">Metadata & assignment</p>
        </div>
        <Badge
          className={cn(
            'text-[12px] font-mono capitalize shrink-0 border',
            isTemplate
              ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
              : status === 'draft'
              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
          )}
        >
          {isTemplate ? 'Template' : status === 'draft' ? 'Draft' : 'Active'}
        </Badge>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[12px] font-medium text-foreground block mb-1">Plan Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cutting Phase — High Protein"
            className="w-full h-8 px-2.5 rounded-lg bg-secondary/40 border border-border text-xs focus:outline-none focus:border-primary"
          />
        </div>

        {!isTemplate ? (
          <div>
            <label className="text-[12px] font-medium text-foreground block mb-1">Assigned Client</label>
            <button
              type="button"
              onClick={() => setClientPickerOpen(true)}
              className={cn(
                'w-full h-8 px-2.5 rounded-lg border text-xs text-left flex items-center justify-between transition-colors',
                selectedClient
                  ? 'bg-secondary/40 border-border text-foreground'
                  : 'bg-secondary/20 border-dashed border-border/80 text-muted-foreground hover:border-primary/50'
              )}
            >
              {selectedClient ? (
                <span className="font-medium truncate">{selectedClient.full_name}</span>
              ) : (
                <span>Select client…</span>
              )}
              <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/40 text-[12px] text-muted-foreground">
            Global template: deep-copied when assigned to clients.
          </div>
        )}

        <div>
          <label className="text-[12px] font-medium text-foreground block mb-1">Coach Notes (optional)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Plan-wide instructions..."
            className="w-full p-2.5 rounded-lg bg-secondary/40 border border-border text-xs focus:outline-none focus:border-primary resize-y"
          />
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // 2. Column 2 Content (Plan Overview + Meal Master List)
  // ─────────────────────────────────────────────────────────────
  const planOverviewContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Plan Header */}
      <div className="shrink-0 p-4 border-b border-white/[0.06] bg-gradient-to-r from-[#0d1322] to-[#0b0f19] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nutrition Plan Name"
                className="text-base sm:text-lg font-display font-semibold text-foreground bg-transparent border-b border-transparent hover:border-white/[0.12] focus:border-primary/50 focus:outline-none transition-colors px-0 py-0.5 rounded-none placeholder:text-muted-foreground"
              />
              <Badge
                className={cn(
                  'text-[12px] font-mono capitalize shrink-0 border',
                  isTemplate
                    ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
                    : status === 'draft'
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                )}
              >
                {isTemplate ? 'Template' : status === 'draft' ? 'Draft' : 'Active'}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground mt-0.5 flex-wrap">
              <span>{selectedClient?.full_name || clientName || 'Unassigned'}</span>
              <span>·</span>
              <span>{meals.length} meals</span>
              {notes && (
                <>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setShowNotesEditor((prev) => !prev)}
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <FileText className="w-3 h-3" /> {showNotesEditor ? 'Hide notes' : 'View notes'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {autosaveEnabled && (
              <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
            )}

            {!isTemplate && meals.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTemplateName(name.includes('Template') ? name : `${name} Template`);
                  setTemplateModalOpen(true);
                }}
                className="text-[12px] h-8"
              >
                <Bookmark className="w-3.5 h-3.5 text-purple-400" /> Template
              </Button>
            )}

            {!isTemplate && status === 'draft' && planId && (
              <Button
                size="sm"
                onClick={handleActivate}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600 text-[12px] h-8"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Activating…' : 'Activate & Assign'}
              </Button>
            )}

            <Button onClick={handleSave} disabled={saving} size="sm" className="text-[12px] h-8 shadow-sm">
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : planId ? 'Save Changes' : 'Save Draft'}
            </Button>
          </div>
        </div>

        {/* Collapsible Plan Notes Editor */}
        {showNotesEditor && (
          <div className="pt-2 border-t border-border/30">
            <label className="text-[12px] font-medium text-foreground block mb-1">
              Instructions & Notes for Client
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Drink at least 3 liters of water. Time carbs around workouts."
              className="w-full p-2 rounded-lg bg-secondary/40 border border-border text-xs focus:outline-none focus:border-primary/50 resize-y"
            />
          </div>
        )}

        {/* Executive Macro Summary Widget */}
        <NutritionMacroSummary totals={planTotals} />
      </div>

      {/* Alert Banners */}
      {(error || successMessage) && (
        <div className="px-4 py-2 shrink-0 space-y-1">
          {error && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </span>
              <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300">
                ✕
              </button>
            </div>
          )}
          {successMessage && (
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[12px] text-emerald-400 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 shrink-0" />
              {successMessage}
            </div>
          )}
        </div>
      )}

      {/* Meal Master List Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border/40 flex items-center justify-between bg-card/20">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground font-mono">
            Meals ({meals.length})
          </span>
          <span className="text-[12px] text-muted-foreground hidden sm:inline">
            Click a meal to open deep editor
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAddMeal()}
          className="text-[12px] h-7 px-2.5 border-dashed hover:border-primary/50"
        >
          <Plus className="w-3 h-3" /> Add Meal
        </Button>
      </div>

      {/* Meals Master List (Scrollable, Draggable) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {meals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 text-center p-6 border border-dashed border-border/60 rounded-xl">
            <div className="w-10 h-10 rounded-xl bg-secondary/50 border border-border flex items-center justify-center mb-2">
              <Utensils className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-semibold text-foreground">No Meals in this Plan</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
              Add your first meal to configure food portions and nutrition values.
            </p>
            <Button size="sm" onClick={() => handleAddMeal()} className="text-xs h-8">
              <Plus className="w-3.5 h-3.5" /> Add First Meal
            </Button>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleMealDragEnd}>
            <Droppable droppableId="meals-master-list">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                  {meals.map((m, mIdx) => {
                    const mTotals = calculateSingleMealTotals(m);
                    const isSelected = selectedMealIndex === mIdx;
                    const itemsCount = m.items?.length || 0;

                    return (
                      <Draggable key={m.id || `meal-${mIdx}`} draggableId={m.id || `meal-${mIdx}`} index={mIdx}>
                        {(dragProvided, snapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            onClick={() => {
                              setSelectedMealIndex(mIdx);
                              setMobileStep(3);
                            }}
                            className={cn(
                              'group relative rounded-xl border p-3 cursor-pointer transition-all duration-150 select-none',
                              isSelected
                                ? 'bg-[#0d1322] border-primary/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-primary before:rounded-r'
                                : 'bg-[#0b0f19] border-white/[0.08] hover:border-white/[0.12] hover:bg-[#0d1322]',
                              snapshot.isDragging && 'shadow-lg ring-2 ring-primary/30 z-20 bg-[#0d1322]'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              {/* Left info: drag handle + meal name */}
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div
                                  {...dragProvided.dragHandleProps}
                                  className="p-1 -ml-1 rounded text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Drag to reorder meal"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[14px] font-semibold text-foreground truncate">
                                      {m.meal_name || `Meal ${mIdx + 1}`}
                                    </span>
                                    {m.notes && (
                                      <span
                                        className="text-[12px] text-muted-foreground truncate max-w-[120px] italic hidden sm:inline"
                                        title={m.notes}
                                      >
                                        · {m.notes}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground font-mono">
                                    <span className="text-foreground/90 font-medium font-sans">
                                      {itemsCount} {itemsCount === 1 ? 'food' : 'foods'}
                                    </span>
                                    <span>·</span>
                                    <span className="text-primary font-semibold">
                                      {mTotals.calories} kcal
                                    </span>
                                    <span>·</span>
                                    <span className="text-sky-400">{mTotals.protein}P</span>
                                    <span className="text-amber-400">{mTotals.carbs}C</span>
                                    <span className="text-rose-400">{mTotals.fat}F</span>
                                  </div>
                                </div>
                              </div>

                              {/* Right: Actions & chevron */}
                              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => handleMoveMeal(mIdx, -1)}
                                  disabled={mIdx === 0}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                                  title="Move up"
                                >
                                  <ChevronUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveMeal(mIdx, 1)}
                                  disabled={mIdx === meals.length - 1}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                                  title="Move down"
                                >
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDuplicateMeal(mIdx)}
                                  className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ml-0.5"
                                  title="Duplicate meal"
                                  aria-label={`Duplicate ${m.meal_name || `Meal ${mIdx + 1}`}`}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMeal(mIdx)}
                                  className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors ml-0.5"
                                  title="Delete meal"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <ChevronRight
                                  className={cn(
                                    'w-4 h-4 text-muted-foreground transition-transform duration-150 ml-1',
                                    isSelected && 'text-primary rotate-90 sm:rotate-0'
                                  )}
                                />
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
        )}

        {meals.length > 0 && (
          <div className="pt-2 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAddMeal()}
              className="text-xs h-8 border-dashed hover:border-primary/50 text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" /> Add Another Meal
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // 3. Column 3 Content (Nutrition Deep Editor)
  // ─────────────────────────────────────────────────────────────
  const activeMealTotals = activeMeal ? calculateSingleMealTotals(activeMeal) : null;
  const activeMealItems = activeMeal?.items || [];

  const deepEditorContent = activeMeal ? (
    <div className="flex flex-col h-full overflow-hidden bg-card/10">
      {/* Editor Header */}
      <div className="shrink-0 p-4 border-b border-border/40 bg-card/40 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeMeal.meal_name}
                onChange={(e) => handleRenameMeal(selectedMealIndex, e.target.value)}
                placeholder="Meal Name"
                className="text-base font-display font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border/60 focus:border-primary focus:outline-none transition-colors px-0 py-0.5 rounded-none"
              />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <div className="flex gap-1 overflow-x-auto py-0.5">
                {SUGGESTED_MEAL_NAMES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleRenameMeal(selectedMealIndex, s)}
                    className={cn(
                      'text-[12px] px-2 py-0.5 rounded transition-colors',
                      activeMeal.meal_name === s
                        ? 'bg-primary/20 text-primary border border-primary/30 font-medium'
                        : 'bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Meal Macro Badge */}
            <div className="px-2.5 py-1 rounded-lg bg-secondary/60 border border-border/60 font-mono text-[12px] text-foreground">
              <span className="font-semibold text-primary">{activeMealTotals.calories} kcal</span>
              <span className="text-muted-foreground mx-1.5">·</span>
              <span>{activeMealTotals.protein}P</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span>{activeMealTotals.carbs}C</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span>{activeMealTotals.fat}F</span>
            </div>

            {/* Close / Collapse Deep Editor */}
            <button
              type="button"
              onClick={() => {
                setSelectedMealIndex(null);
                setMobileStep(2);
              }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              title="Close meal editor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Meal Notes / Timing */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] font-medium text-foreground flex items-center gap-1">
              <StickyNote className="w-3 h-3 text-primary" />
              Meal Notes &amp; Timing (optional)
            </span>
          </div>
          <input
            type="text"
            value={activeMeal.notes || ''}
            onChange={(e) => handleChangeMealNotes(selectedMealIndex, e.target.value)}
            placeholder="e.g. 08:30 AM · Take with omega-3 and multivitamin."
            className="w-full h-8 px-2.5 rounded-lg bg-secondary/40 border border-border text-xs focus:outline-none focus:border-primary/50 text-foreground"
          />
        </div>
      </div>

      {/* Foods Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border/40 flex items-center justify-between bg-card/20">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground font-mono">
            Foods &amp; Portions ({activeMealItems.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setBulkPickerOpen(true)}
            className="text-[12px] h-7 px-2.5 shadow-sm"
          >
            <Plus className="w-3 h-3" /> Add Foods
          </Button>
        </div>
      </div>

      {/* Foods List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {activeMealItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-6 border border-dashed border-border/60 rounded-xl">
            <div className="w-10 h-10 rounded-xl bg-secondary/50 border border-border flex items-center justify-center mb-2">
              <Apple className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-semibold text-foreground">No Foods in {activeMeal.meal_name}</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
              Search the food database to add foods with automatic macro calculations.
            </p>
            <Button size="sm" onClick={() => setBulkPickerOpen(true)} className="text-xs h-8">
              <Plus className="w-3.5 h-3.5" /> Add Foods
            </Button>
          </div>
        ) : (
          <>
            {activeMealItems.map((it, itIdx) => (
              <NutritionItemRow
                key={it.id || `${it.food_id}-${itIdx}`}
                item={it}
                onUpdateQuantity={(newAmt, newUnit) => {
                  const baseFood = it.base_food || {
                    name: it.food_name,
                    brand: it.brand,
                    serving_size: 100,
                    serving_unit: 'g',
                    calories: it.calories && it.amount ? (Number(it.calories) / Number(it.amount)) * 100 : 0,
                    protein: it.protein && it.amount ? (Number(it.protein) / Number(it.amount)) * 100 : 0,
                    carbs: it.carbs && it.amount ? (Number(it.carbs) / Number(it.amount)) * 100 : 0,
                    fat: it.fat && it.amount ? (Number(it.fat) / Number(it.amount)) * 100 : 0,
                  };
                  const numAmt = Number(newAmt) || 0;
                  const scaled = calculateFoodNutrients(baseFood, numAmt, newUnit || it.unit || 'g');
                  const updated = {
                    ...it,
                    amount: numAmt,
                    unit: newUnit || it.unit || 'g',
                    calories: scaled.calories,
                    protein: scaled.protein,
                    carbs: scaled.carbs,
                    fat: scaled.fat,
                    gramWeight: scaled.gramWeight,
                    base_food: baseFood,
                  };
                  handleUpdateItemAmount(selectedMealIndex, itIdx, updated);
                }}
                onRemove={() => handleRemoveItemFromMeal(selectedMealIndex, itIdx)}
                onReplace={() => {
                  setReplacementTarget({
                    mealIndex: selectedMealIndex,
                    itemIndex: itIdx,
                    item: it,
                  });
                }}
              />
            ))}

            <div className="pt-2 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkPickerOpen(true)}
                className="text-xs h-8 border-dashed hover:border-primary/50 text-muted-foreground hover:text-foreground w-full"
              >
                <Plus className="w-3.5 h-3.5" /> Add More Foods
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Deep Editor Modals */}
      <BulkFoodPickerModal
        open={bulkPickerOpen}
        onClose={() => setBulkPickerOpen(false)}
        onAddItems={(foodItems) => {
          handleAddItemsToMeal(selectedMealIndex, foodItems);
          setBulkPickerOpen(false);
        }}
      />

      <FoodPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectFood={(foodItem) => {
          handleAddItemToMeal(selectedMealIndex, foodItem);
          setPickerOpen(false);
        }}
      />

      <ReplaceFoodModal
        open={replacementTarget !== null}
        onClose={() => setReplacementTarget(null)}
        item={replacementTarget?.item || null}
        workspaceId={wsId}
        onApply={handleApplyReplacement}
      />
    </div>
  ) : null;

  // ─────────────────────────────────────────────────────────────
  // 4. Main Render Layout
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        embedded
          ? 'flex flex-col h-full overflow-hidden'
          : 'ybs-planner flex flex-col h-[calc(100dvh-156px)] min-h-[580px] overflow-hidden'
      )}
    >
      {/* Standalone-only: top bar with back navigation */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-card/80 shrink-0">
          <button
            type="button"
            onClick={async () => {
              await autosave.flush();
              navigate(returnTo || '/nutrition');
            }}
            className="p-1.5 rounded-lg bg-secondary/50 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Back to Nutrition Plans"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] font-semibold uppercase tracking-wider text-primary font-mono">
            {isTemplate ? 'Nutrition Template Builder' : 'Nutrition Plan Builder'}
          </span>
          <div className="flex items-center gap-2">
            <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
            <Button
              variant="secondary"
              onClick={() => {
                setTemplateName(name ? `${name} (Template)` : 'New Nutrition Template');
                setTemplateModalOpen(true);
              }}
              className="text-[12px] h-8"
            >
              <Bookmark className="w-3.5 h-3.5 text-purple-400" /> Template
            </Button>
            <Button onClick={handleSave} disabled={saving} className="text-[12px] h-8">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : planId ? 'Save Changes' : 'Save Draft'}
            </Button>
          </div>
        </div>
      )}

      {/* 3-Column Resizable Layout (Desktop) */}
      <div className="flex-1 overflow-hidden">
        <div className="hidden 2xl:flex h-full">
          <PanelGroup
            direction="horizontal"
            autoSaveId={sidebarSlot ? 'ybs-client-nutrition-3col' : 'ybs-standalone-nutrition-3col'}
            className="h-full"
          >
            {/* Column 1: Navigation Sidebar */}
            <Panel
              id="nutrition-col1"
              order={1}
              defaultSize={24}
              minSize={18}
              maxSize={32}
              className="flex flex-col overflow-hidden border-r border-border/40"
            >
              <div className="flex-1 overflow-y-auto h-full">
                {sidebarSlot || standaloneConfigSidebar}
              </div>
            </Panel>

            <PlannerResizeHandle id="nutrition-gutter-1-2" />

            {/* Column 2: Plan Overview + Meal Master List */}
            <Panel
              id="nutrition-col2"
              order={2}
              defaultSize={showMealEditor ? 32 : 76}
              minSize={24}
              className="flex flex-col overflow-hidden"
            >
              {planOverviewContent}
            </Panel>

            {/* Column 3: Meal Deep Editor (slides in when meal is selected) */}
            {showMealEditor && (
              <>
                <PlannerResizeHandle id="nutrition-gutter-2-3" />
                <Panel
                  id="nutrition-col3"
                  order={3}
                  defaultSize={44}
                  minSize={28}
                  className="flex flex-col overflow-hidden border-l border-border/40"
                >
                  <div className="flex-1 overflow-y-auto h-full animate-in fade-in-50 duration-200 slide-in-from-right-1">
                    {deepEditorContent}
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>

        {/* Mobile Progressive Navigation (Single Panel with back navigation) */}
        <div className="2xl:hidden h-full overflow-y-auto">
          {mobileStep === 1 && (
            <div className="h-full">
              {sidebarSlot || standaloneConfigSidebar}
              <Button className="m-4" onClick={() => setMobileStep(2)}>Continue to meal plan</Button>
            </div>
          )}

          {mobileStep === 2 && (
            <div className="h-full flex flex-col">
              {(sidebarSlot || !embedded) && (
                <button
                  type="button"
                  onClick={() => setMobileStep(1)}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-3 border-b border-border/40 shrink-0 text-left bg-card/40"
                >
                  ← Plan settings
                </button>
              )}
              <div className="flex-1 overflow-y-auto">
                {planOverviewContent}
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
                ← Meals List
              </button>
              <div className="flex-1 overflow-y-auto animate-in fade-in-50 duration-200">
                {deepEditorContent}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Standalone Client Picker Modal */}
      <Modal open={clientPickerOpen} onClose={() => setClientPickerOpen(false)} title="Select Client" size="md">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search clients by name, code, or email…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/40"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-border/40 border border-border rounded-lg p-1">
            {filteredClients.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No clients found.</p>
            ) : (
              filteredClients.map((c) => {
                const isSelected = selectedClient?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedClient(c);
                      setClientPickerOpen(false);
                    }}
                    className={cn(
                      'w-full text-left p-2.5 rounded-md flex items-center justify-between transition-colors text-xs',
                      isSelected ? 'bg-primary/15' : 'hover:bg-secondary/50'
                    )}
                  >
                    <div>
                      <span className="font-semibold text-foreground block">{c.full_name}</span>
                      <span className="text-[12px] text-muted-foreground font-mono">
                        {c.client_code} · {c.email || c.phone || 'No contact'}
                      </span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* Save as Template Modal */}
      <Modal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} title="Save as Template" size="sm">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            This will create an independent template copy with all current meals and snapshotted foods.
          </p>
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1">Template Name</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. 2500 kcal High Protein Template"
              className="w-full h-9 px-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()}>
              {savingTemplate ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
