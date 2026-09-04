import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import { FoodsService } from '@/services/foods';
import { scaleFoodNutrients } from '@/services/nutrition';
import { Search, Apple, Check, AlertCircle, Sparkles } from 'lucide-react';
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

  useEffect(() => {
    if (!open) {
      setSelectedFood(null);
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

    return () => { isMounted = false; };
  }, [open]);

  // Select food and initialize amount to food's default serving size
  const handleSelectFood = (food) => {
    setSelectedFood(food);
    const defaultAmount = Number(food.serving_size) > 0 ? Number(food.serving_size) : 100;
    setAmount(defaultAmount);
  };

  // Live scaled nutrition preview for the selected food
  const scaled = useMemo(() => {
    if (!selectedFood) return null;
    return scaleFoodNutrients(selectedFood, amount);
  }, [selectedFood, amount]);

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
    if (!selectedFood || !scaled || scaled.warning) return;

    onSelectFood({
      food_id: selectedFood.id,
      food_name: selectedFood.name,
      brand: selectedFood.brand || null,
      amount: Number(amount),
      unit: selectedFood.serving_unit || 'g',
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fat: scaled.fat,
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
              placeholder="Search by English, Arabic, brand, or alias…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              autoFocus
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[12px] focus:outline-none focus:border-primary/40 text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Results List */}
        <div className="border border-border rounded-lg overflow-hidden">
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
                      'w-full text-left p-2.5 rounded-md flex items-center justify-between transition-colors text-xs',
                      isSelected ? 'bg-primary/15 border border-primary/30' : 'hover:bg-secondary/40'
                    )}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground truncate">{f.name}</span>
                        {f.name_ar && <span className="text-[11px] text-muted-foreground" dir="rtl">({f.name_ar})</span>}
                        {f.brand && (
                          <Badge className="text-[10px] py-0 px-1 text-muted-foreground bg-secondary/50">
                            {f.brand}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Base: {f.serving_size || 100} {f.serving_unit || 'g'} · {Math.round(f.calories || 0)} kcal · {f.protein || 0}P / {f.carbs || 0}C / {f.fat || 0}F
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
          <div className="surface-card p-4 rounded-xl border border-primary/25 bg-primary/5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-primary font-semibold">Selected Food</span>
                <h4 className="text-sm font-semibold text-foreground">{selectedFood.name}</h4>
                {selectedFood.brand && <span className="text-xs text-muted-foreground">{selectedFood.brand}</span>}
              </div>
              <div className="text-right">
                <span className="text-[11px] text-muted-foreground">Serving Unit</span>
                <p className="text-xs font-mono font-medium">{selectedFood.serving_unit || 'g'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground block mb-1 font-medium">
                  Quantity ({selectedFood.serving_unit || 'g'})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                    {selectedFood.serving_unit || 'g'}
                  </span>
                </div>
              </div>
            </div>

            {scaled?.warning ? (
              <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 p-2 rounded-md border border-amber-500/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{scaled.warning}</span>
              </div>
            ) : scaled ? (
              <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                <div className="bg-background/80 p-2 rounded-lg border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase">Calories</p>
                  <p className="text-sm font-semibold text-primary">{scaled.calories} kcal</p>
                </div>
                <div className="bg-background/80 p-2 rounded-lg border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase">Protein</p>
                  <p className="text-sm font-semibold text-foreground">{scaled.protein}g</p>
                </div>
                <div className="bg-background/80 p-2 rounded-lg border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase">Carbs</p>
                  <p className="text-sm font-semibold text-foreground">{scaled.carbs}g</p>
                </div>
                <div className="bg-background/80 p-2 rounded-lg border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase">Fat</p>
                  <p className="text-sm font-semibold text-foreground">{scaled.fat}g</p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
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
