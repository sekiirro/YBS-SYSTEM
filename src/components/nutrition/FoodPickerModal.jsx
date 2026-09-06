import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import { FoodsService } from '@/services/foods';
import {
  getAvailableUnitsForFood,
  calculateFoodNutrients,
  resolveFoodUnit,
} from '@/lib/nutritionUnits';
import FoodQuantityInput from './FoodQuantityInput';
import { Search, Check, AlertCircle, Utensils, Info } from 'lucide-react';
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

export default function FoodPickerModal({ open, onClose, onSelectFood }) {
  const [loading, setLoading] = useState(false);
  const [foods, setFoods] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedFood, setSelectedFood] = useState(null);
  const [amount, setAmount] = useState(100);
  const [unit, setUnit] = useState('g');

  useEffect(() => {
    if (!open) {
      setSelectedFood(null);
      setSearch('');
      setCategory('all');
      setAmount(100);
      setUnit('g');
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

  // Select food and initialize smart default unit + quantity
  const handleSelectFood = (food) => {
    setSelectedFood(food);
    const available = getAvailableUnitsForFood(food);
    // Pick the most intuitive default unit:
    // If food has discrete count units (e.g. medium, piece, slice, scoop, tbsp) as first non-g unit, or default to available[0]
    const preferredUnit = available.find((u) => u.id !== 'g' && u.id !== 'kg') || available[0];
    setUnit(preferredUnit.id);
    setAmount(preferredUnit.defaultAmount || 1);
  };

  // Live scaled nutrition preview for the selected food & unit
  const scaled = useMemo(() => {
    if (!selectedFood) return null;
    return calculateFoodNutrients(selectedFood, amount, unit);
  }, [selectedFood, amount, unit]);

  // Search filter across English name, Arabic name, brand, and aliases
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
    if (!selectedFood || !scaled || scaled.warning || Number(amount) <= 0) return;

    onSelectFood({
      food_id: selectedFood.id,
      food_name: selectedFood.name,
      brand: selectedFood.brand || null,
      amount: Number(amount),
      unit: unit || 'g',
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fat: scaled.fat,
      gram_weight: scaled.gramWeight,
      base_food: selectedFood,
    });

    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Food to Meal" size="lg">
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
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40 text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[12px] focus:outline-none focus:border-primary/40 text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Results List */}
        <div className="border border-border/80 rounded-xl overflow-hidden bg-card">
          <div className="max-h-52 overflow-y-auto divide-y divide-border/40 p-1">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading food database…</div>
            ) : filteredFoods.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No matching foods found.</div>
            ) : (
              filteredFoods.map((f) => {
                const isSelected = selectedFood?.id === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSelectFood(f)}
                    className={cn(
                      'w-full text-left p-2.5 rounded-lg flex items-center justify-between transition-colors text-xs',
                      isSelected
                        ? 'bg-primary/15 border border-primary/35 text-foreground'
                        : 'hover:bg-secondary/50 text-foreground/90'
                    )}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{f.name}</span>
                        {f.name_ar && (
                          <span className="text-[11px] text-muted-foreground" dir="rtl">
                            ({f.name_ar})
                          </span>
                        )}
                        {f.brand && (
                          <Badge className="text-[10px] py-0 px-1 text-muted-foreground bg-secondary/60 border border-border/40 font-normal">
                            {f.brand}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground/80 mt-0.5 font-mono">
                        Per 100g: {Math.round(f.calories || 0)} kcal · {f.protein || 0}P / {f.carbs || 0}C / {f.fat || 0}F
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Food Quantity & Macro Calculation Preview */}
        {selectedFood && (
          <div className="surface-card p-4 rounded-xl border border-primary/30 bg-primary/[0.03] space-y-3.5">
            {/* Food Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">
                    Selected Food
                  </span>
                  {selectedFood.category && (
                    <span className="text-[10px] text-muted-foreground capitalize">
                      · {selectedFood.category}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-semibold text-foreground mt-0.5">{selectedFood.name}</h4>
                {selectedFood.brand && (
                  <span className="text-xs text-muted-foreground">{selectedFood.brand}</span>
                )}
              </div>

              {/* Database Reference Note */}
              <div className="text-right shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block font-medium">
                  DB Reference
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  100g = {Math.round(selectedFood.calories || 0)} kcal
                </span>
              </div>
            </div>

            {/* Custom Quantity & Context-Aware Unit Control */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-border/40">
              <div>
                <label className="text-xs text-foreground font-medium block">
                  Portion & Quantity
                </label>
                <span className="text-[11px] text-muted-foreground block">
                  Choose unit (e.g. grams, count, tbsp) for automatic normalization
                </span>
              </div>

              {/* Reusable Stepper & Unit Dropdown */}
              <div className="shrink-0">
                <FoodQuantityInput
                  amount={amount}
                  unit={unit}
                  food={selectedFood}
                  size="md"
                  showGramBadge={true}
                  onChange={({ amount: newAmt, unit: newU }) => {
                    setAmount(newAmt);
                    setUnit(newU);
                  }}
                />
              </div>
            </div>

            {/* Normalization Helper Info */}
            {scaled && unit !== 'g' && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/30 px-3 py-1.5 rounded-lg border border-border/30">
                <Info className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  Normalized to <strong className="text-foreground font-mono">{scaled.gramWeight}g</strong> from the 100g database standard.
                </span>
              </div>
            )}

            {/* Error or Warning */}
            {scaled?.warning ? (
              <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{scaled.warning}</span>
              </div>
            ) : scaled ? (
              /* Live Calculated Nutrition Cards */
              <div className="grid grid-cols-4 gap-2 pt-0.5 text-center">
                <div className="bg-background/90 p-2.5 rounded-xl border border-primary/20">
                  <p className="text-[10px] text-muted-foreground uppercase font-medium">Calories</p>
                  <p className="text-base font-bold text-primary font-mono">{scaled.calories}</p>
                  <span className="text-[10px] text-muted-foreground font-mono">kcal</span>
                </div>
                <div className="bg-background/90 p-2.5 rounded-xl border border-border/60">
                  <p className="text-[10px] text-muted-foreground uppercase font-medium">Protein</p>
                  <p className="text-base font-bold text-foreground font-mono">{scaled.protein}g</p>
                  <span className="text-[10px] text-muted-foreground">
                    {scaled.calories > 0 ? Math.round((scaled.protein * 4 * 100) / scaled.calories) : 0}%
                  </span>
                </div>
                <div className="bg-background/90 p-2.5 rounded-xl border border-border/60">
                  <p className="text-[10px] text-muted-foreground uppercase font-medium">Carbs</p>
                  <p className="text-base font-bold text-foreground font-mono">{scaled.carbs}g</p>
                  <span className="text-[10px] text-muted-foreground">
                    {scaled.calories > 0 ? Math.round((scaled.carbs * 4 * 100) / scaled.calories) : 0}%
                  </span>
                </div>
                <div className="bg-background/90 p-2.5 rounded-xl border border-border/60">
                  <p className="text-[10px] text-muted-foreground uppercase font-medium">Fat</p>
                  <p className="text-base font-bold text-foreground font-mono">{scaled.fat}g</p>
                  <span className="text-[10px] text-muted-foreground">
                    {scaled.calories > 0 ? Math.round((scaled.fat * 9 * 100) / scaled.calories) : 0}%
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!selectedFood || !scaled || !!scaled.warning || Number(amount) <= 0}
          >
            Add to Meal
          </Button>
        </div>
      </div>
    </Modal>
  );
}
