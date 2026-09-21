import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import { FoodsService } from '@/services/foods';
import { getAvailableUnitsForFood, calculateFoodNutrients } from '@/lib/nutritionUnits';
import FoodQuantityInput from './FoodQuantityInput';
import { Search, Check, AlertCircle, Utensils, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'protein', label: 'Proteins' },
  { value: 'carbs', label: 'Carbs & Grains' },
  { value: 'fat', label: 'Fats & Oils' },
  { value: 'dairy', label: 'Dairy & Eggs' },
  { value: 'fruits', label: 'Fruits' },
  { value: 'vegetables', label: 'Vegetables' },
  { value: 'other', label: 'Other / Snacks' },
];

/**
 * Bulk multi-select food picker. Lets the coach pick several foods at once,
 * tweak per-food portions, and add them to a meal as a single batched append
 * (one draft-state update -> one autosave write for the whole meal).
 */
export default function BulkFoodPickerModal({ open, onClose, onAddItems }) {
  const [loading, setLoading] = useState(false);
  const [foods, setFoods] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  // Ordered list of selected food ids (selection order preserved).
  const [selectedIds, setSelectedIds] = useState([]);
  // Per-food portion state: { [foodId]: { amount, unit } }.
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setQuantities({});
      setSearch('');
      setCategory('all');
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await FoodsService.list();
        if (isMounted) setFoods(data || []);
      } catch (err) {
        console.error('Failed to load foods:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [open]);

  const foodById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);

  const handleToggleFood = (food) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(food.id);
      if (exists) {
        const next = prev.filter((id) => id !== food.id);
        setQuantities((q) => {
          const copy = { ...q };
          delete copy[food.id];
          return copy;
        });
        return next;
      }
      const available = getAvailableUnitsForFood(food);
      // Prefer grams as the default serving unit — the food database is
      // normalized per 100g, so the g profile carries the canonical amount.
      const preferredUnit = available.find((u) => u.id === 'g') || available[0];
      setQuantities((q) => ({
        ...q,
        [food.id]: { amount: preferredUnit.defaultAmount || 100, unit: preferredUnit.id },
      }));
      return [...prev, food.id];
    });
  };

  const handleQuantityChange = (foodId, { amount, unit }) => {
    setQuantities((q) => ({ ...q, [foodId]: { amount, unit } }));
  };

  // Live scaled macros for the selected panel.
  const selectedFoods = useMemo(
    () => selectedIds.map((id) => foodById.get(id)).filter(Boolean),
    [selectedIds, foodById]
  );
  const scaledByFood = useMemo(() => {
    const map = {};
    for (const f of selectedFoods) {
      const q = quantities[f.id] || {};
      map[f.id] = calculateFoodNutrients(f, q.amount, q.unit);
    }
    return map;
  }, [selectedFoods, quantities]);

  const filteredFoods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return foods.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (!q) return true;
      const haystack = [f.name, f.name_ar, f.brand, ...(f.aliases || [])]
        .filter(Boolean)
        .map((s) => s.toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }, [foods, search, category]);

  const handleAdd = () => {
    if (selectedFoods.length === 0) return;

    const items = selectedFoods.map((food) => {
      const q = quantities[food.id];
      const scaled = scaledByFood[food.id];
      return {
        food_id: food.id,
        food_name: food.name,
        brand: food.brand || null,
        amount: Number(q?.amount),
        unit: q?.unit || 'g',
        calories: scaled?.calories || 0,
        protein: scaled?.protein || 0,
        carbs: scaled?.carbs || 0,
        fat: scaled?.fat || 0,
        gram_weight: scaled?.gramWeight || null,
        base_food: food,
      };
    });

    onAddItems(items);
    setSelectedIds([]);
    setQuantities({});
    onClose();
  };

  const selectedTotal = selectedFoods.reduce(
    (acc, f) => {
      const s = scaledByFood[f.id] || {};
      acc.calories += Number(s.calories) || 0;
      return acc;
    },
    { calories: 0 }
  );

  return (
    <Modal open={open} onClose={onClose} title="Add Foods to Meal" size="lg">
      <div className="space-y-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by food name, Arabic, brand, or alias…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/50 border border-border text-[14px] focus:outline-none focus:border-primary/40 text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="sm:w-52 h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[12px] focus:outline-none focus:border-primary/40 text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Results List with multi-select */}
        <div className="border border-border/80 rounded-xl overflow-hidden bg-card">
          <div className="max-h-52 overflow-y-auto divide-y divide-border/40 p-1">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading food database…</div>
            ) : filteredFoods.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No matching foods found.</div>
            ) : (
              filteredFoods.map((f) => {
                const isSelected = selectedIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleToggleFood(f)}
                    className={cn(
                      'w-full text-left p-2.5 rounded-lg flex items-center justify-between gap-2 transition-colors text-xs',
                      isSelected
                        ? 'bg-primary/15 border border-primary/35 text-foreground'
                        : 'hover:bg-secondary/50 text-foreground/90 border border-transparent'
                    )}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{f.name}</span>
                        {f.name_ar && (
                          <span className="text-[12px] text-muted-foreground" dir="rtl">
                            ({f.name_ar})
                          </span>
                        )}
                        {f.brand && (
                          <Badge className="text-[12px] py-0 px-1 text-muted-foreground bg-secondary/60 border border-border/40 font-normal">
                            {f.brand}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[12px] text-muted-foreground/80 mt-0.5 font-mono">
                        Per 100g: {Math.round(f.calories || 0)} kcal · {f.protein || 0}P / {f.carbs || 0}C / {f.fat || 0}F
                      </div>
                    </div>
                    <div
                      className={cn(
                        'w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors',
                        isSelected ? 'bg-primary border-primary' : 'border-border'
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Items Panel with Per-Item Portions */}
        {selectedFoods.length > 0 && (
          <div className="surface-card p-4 rounded-xl border border-primary/30 bg-primary/[0.03] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Selected Items ({selectedFoods.length})
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                ~{Math.round(selectedTotal.calories)} kcal total
              </span>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {selectedFoods.map((f) => {
                const scaled = scaledByFood[f.id];
                const hasWarning = !!scaled?.warning;
                return (
                  <div
                    key={f.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-background/90 border border-primary/20"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">{f.name}</p>
                      <p className="text-[12px] text-muted-foreground font-mono">
                        {Number(scaled?.calories) || 0} kcal · {Number(scaled?.protein) || 0}P / {Number(scaled?.carbs) || 0}C / {Number(scaled?.fat) || 0}F
                      </p>
                      {hasWarning && (
                        <p className="text-[12px] text-amber-400 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3" /> {scaled.warning}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <FoodQuantityInput
                        amount={quantities[f.id]?.amount}
                        unit={quantities[f.id]?.unit}
                        food={f}
                        size="sm"
                        showGramBadge={false}
                        onChange={({ amount, unit }) => handleQuantityChange(f.id, { amount, unit })}
                      />
                      <button
                        type="button"
                        onClick={() => handleToggleFood(f)}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove from selection"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex justify-between items-center gap-2 pt-2 border-t border-border/50">
          <span className="text-[12px] text-muted-foreground flex items-center gap-1.5">
            <Utensils className="w-3.5 h-3.5 text-primary" /> Each food keeps its own portion — adjust above before adding.
          </span>
          <div className="flex justify-end gap-2 shrink-0">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={selectedFoods.length === 0}>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Add Selected ({selectedFoods.length})
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}