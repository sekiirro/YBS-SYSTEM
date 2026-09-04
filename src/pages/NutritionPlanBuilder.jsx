import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getActiveWorkspaceId } from '@/lib/ybs-auth';
import { NutritionService, calculatePlanTotals } from '@/services/nutrition';
import { ClientsService } from '@/services/clients';
import { PageHeader, LoadingState, Button, Badge, Modal, Input, TextArea } from '@/components/ui';
import PlanSummaryBar from '@/components/nutrition/PlanSummaryBar';
import MealSection from '@/components/nutrition/MealSection';
import { ArrowLeft, Save, Bookmark, Plus, Users, Search, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NutritionPlanBuilder() {
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

  // Plan Meta State
  const [planId, setPlanId] = useState(id || null);
  const [isTemplate, setIsTemplate] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  // Meals State (each meal contains items[])
  const [meals, setMeals] = useState([]);

  // Client Picker State
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  // Template Save Modal State
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // ── 1. Load Initial Data ──
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);

        // Load all available clients for selector
        const clientList = await ClientsService.list({});
        if (isMounted) setClients(clientList || []);

        if (id) {
          // Editing existing plan
          const plan = await NutritionService.getById(id);
          if (isMounted && plan) {
            setPlanId(plan.id);
            setName(plan.name || '');
            setNotes(plan.notes || '');
            setIsTemplate(!!plan.is_template);
            if (plan.client_id) {
              const matched = clientList.find((c) => c.id === plan.client_id);
              setSelectedClient(matched || { id: plan.client_id, full_name: plan.client_name });
            }
            setMeals(plan.meals || []);
          }
        } else if (templateId) {
          // Pre-filling builder from a template (deep copy without saving to DB)
          const tpl = await NutritionService.getById(templateId);
          if (isMounted && tpl) {
            setPlanId(null); // Will be a brand new plan on save
            setName(`${tpl.name} (Copy)`);
            setNotes(tpl.notes || '');
            setIsTemplate(false);

            // Deep-copy meals and items so original template is never linked
            const copiedMeals = (tpl.meals || []).map((m, mIdx) => ({
              id: `copied-meal-${mIdx}-${Date.now()}`,
              meal_name: m.meal_name,
              sort_order: mIdx,
              day_number: 1,
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
              })),
            }));
            setMeals(copiedMeals);

            if (queryClientId) {
              const matched = clientList.find((c) => c.id === queryClientId);
              if (matched) setSelectedClient(matched);
            }
          }
        } else {
          // New Blank Plan
          setName('New Nutrition Plan');
          setIsTemplate(searchParams.get('type') === 'template');
          setMeals([
            { id: `meal-1-${Date.now()}`, meal_name: 'Breakfast', sort_order: 0, day_number: 1, items: [] },
            { id: `meal-2-${Date.now()}`, meal_name: 'Lunch', sort_order: 1, day_number: 1, items: [] },
            { id: `meal-3-${Date.now()}`, meal_name: 'Dinner', sort_order: 2, day_number: 1, items: [] },
          ]);

          if (queryClientId) {
            const matched = clientList.find((c) => c.id === queryClientId);
            if (matched) setSelectedClient(matched);
          }
        }
      } catch (err) {
        console.error('Error loading builder state:', err);
        if (isMounted) setError('Failed to load plan details');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => { isMounted = false; };
  }, [id, templateId, queryClientId, searchParams]);

  // ── 2. Live Plan Totals ──
  const planTotals = useMemo(() => calculatePlanTotals(meals), [meals]);

  // ── 3. Meal State Modifiers ──
  const handleAddMeal = (customName) => {
    const mealName = customName || `Meal ${meals.length + 1}`;
    setMeals((prev) => [
      ...prev,
      {
        id: `meal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        meal_name: mealName,
        sort_order: prev.length,
        day_number: 1,
        items: [],
      },
    ]);
  };

  const handleRenameMeal = (index, newName) => {
    setMeals((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], meal_name: newName };
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
  };

  const handleRemoveMeal = (index) => {
    if (meals.length <= 1) {
      if (!window.confirm('Remove this meal? Your plan will have no meals.')) return;
    }
    setMeals((prev) => prev.filter((_, idx) => idx !== index).map((m, idx) => ({ ...m, sort_order: idx })));
  };

  const handleAddItemToMeal = (mealIndex, foodItem) => {
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
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

  const handleUpdateItemAmount = (mealIndex, itemIndex, updatedItem) => {
    setMeals((prev) => {
      const next = [...prev];
      const targetMeal = next[mealIndex];
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
      next[mealIndex] = {
        ...targetMeal,
        items: (targetMeal.items || []).filter((_, idx) => idx !== itemIndex),
      };
      return next;
    });
  };

  // ── 4. Save Plan ──
  const handleSave = async () => {
    setError('');

    if (!name.trim()) {
      setError('Please provide a plan name.');
      return;
    }

    if (!isTemplate && !selectedClient) {
      setError('Please select a client for this plan.');
      return;
    }

    if (meals.length === 0) {
      setError('Please add at least one meal to the plan.');
      return;
    }

    try {
      setSaving(true);

      const planPayload = {
        workspace_id: wsId,
        client_id: isTemplate ? null : selectedClient?.id,
        assigned_ybs_coach_id: user?.id,
        name: name.trim(),
        is_template: isTemplate,
        notes: notes.trim() || null,
      };

      if (planId) {
        // Update existing plan
        await NutritionService.update(planId, planPayload, meals);
      } else {
        // Create new plan
        await NutritionService.create(planPayload, meals);
      }

      navigate('/nutrition');
    } catch (err) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save nutrition plan');
    } finally {
      setSaving(false);
    }
  };

  // ── 5. Save as Independent Template ──
  const handleSaveAsTemplate = async () => {
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
      alert('Template saved successfully!');
    } catch (err) {
      console.error('Template save failed:', err);
      alert('Failed to save template: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingTemplate(false);
    }
  };

  // Client filtering
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

  if (loading) return <LoadingState label="Loading Nutrition Plan Builder…" />;

  return (
    <div className="space-y-6 pb-16">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/nutrition')}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl lg:text-2xl font-display font-semibold text-foreground">
                {planId ? 'Edit Nutrition Plan' : isTemplate ? 'New Nutrition Template' : 'New Client Plan'}
              </h1>
              <Badge className={cn(isTemplate ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20')}>
                {isTemplate ? 'Template' : 'Client Plan'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live calculation with historical macro snapshotting
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {!isTemplate && meals.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTemplateName(name.includes('Template') ? name : `${name} Template`);
                setTemplateModalOpen(true);
              }}
            >
              <Bookmark className="w-3.5 h-3.5" /> Save as Template
            </Button>
          )}

          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : planId ? 'Save Changes' : 'Save Plan'}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center gap-2.5 text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Plan Metadata & Client Picker Card */}
      <div className="surface-card rounded-2xl border border-border p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">Plan Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cutting Phase — High Protein"
            className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:border-primary/50"
          />
        </div>

        {!isTemplate ? (
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1">Assigned Client</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setClientPickerOpen(true)}
                className={cn(
                  'flex-1 h-10 px-3 rounded-lg border text-xs text-left flex items-center justify-between transition-colors',
                  selectedClient
                    ? 'bg-secondary/40 border-border text-foreground'
                    : 'bg-secondary/20 border-dashed border-border/80 text-muted-foreground hover:border-primary/50'
                )}
              >
                {selectedClient ? (
                  <span className="font-medium">
                    {selectedClient.full_name} <span className="font-mono text-muted-foreground">({selectedClient.client_code})</span>
                  </span>
                ) : (
                  <span>Select client…</span>
                )}
                <Users className="w-4 h-4 text-muted-foreground" />
              </button>
              {selectedClient && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col justify-center">
            <span className="text-xs font-semibold text-foreground block mb-1">Scope</span>
            <p className="text-xs text-muted-foreground">
              Global/Workspace template. When used, will be deep-copied for the client without modifying this template.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-foreground block mb-1">Notes / Instructions (optional)</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Drink at least 3 liters of water. Time carbs around workouts."
            className="w-full p-3 rounded-lg bg-secondary/50 border border-border text-xs focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Plan Summary Bar */}
      <PlanSummaryBar totals={planTotals} />

      {/* Meal Sections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-display font-semibold text-foreground">Meals & Foods</h2>
            <p className="text-xs text-muted-foreground">{meals.length} meals configured</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => handleAddMeal()}>
              <Plus className="w-3.5 h-3.5" /> Add Meal
            </Button>
          </div>
        </div>

        {meals.length === 0 ? (
          <div className="surface-card p-12 text-center rounded-2xl border border-dashed border-border/60">
            <p className="text-sm text-muted-foreground mb-3">No meals in this plan yet.</p>
            <Button onClick={() => handleAddMeal()}>
              <Plus className="w-4 h-4" /> Add First Meal
            </Button>
          </div>
        ) : (
          meals.map((m, mIdx) => (
            <MealSection
              key={m.id || mIdx}
              meal={m}
              index={mIdx}
              totalMeals={meals.length}
              onRename={(newName) => handleRenameMeal(mIdx, newName)}
              onMoveUp={() => handleMoveMeal(mIdx, -1)}
              onMoveDown={() => handleMoveMeal(mIdx, 1)}
              onRemove={() => handleRemoveMeal(mIdx)}
              onAddItem={(item) => handleAddItemToMeal(mIdx, item)}
              onUpdateItemAmount={(itIdx, updated) => handleUpdateItemAmount(mIdx, itIdx, updated)}
              onRemoveItem={(itIdx) => handleRemoveItemFromMeal(mIdx, itIdx)}
            />
          ))
        )}
      </div>

      {/* Client Picker Modal */}
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
                      <span className="text-[11px] text-muted-foreground font-mono">{c.client_code} · {c.email || c.phone || 'No contact'}</span>
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
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()}>
              {savingTemplate ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
