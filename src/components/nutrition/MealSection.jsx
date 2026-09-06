import React, { useState, useMemo } from 'react';
import { Button, Badge } from '@/components/ui';
import NutritionItemRow from './NutritionItemRow';
import FoodPickerModal from './FoodPickerModal';
import { scaleFoodNutrients } from '@/services/nutrition';
import { calculateFoodNutrients } from '@/lib/nutritionUnits';
import { ChevronUp, ChevronDown, Trash2, Plus, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';

const SUGGESTED_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Pre-workout', 'Post-workout', 'Snack', 'Snack 1', 'Snack 2'];

export default function MealSection({
  meal,
  index,
  totalMeals,
  onRename,
  onMoveUp,
  onMoveDown,
  onRemove,
  onAddItem,
  onUpdateItemAmount,
  onRemoveItem,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);

  const items = meal.items || [];

  // Live meal macro totals
  const mealTotals = useMemo(() => {
    return items.reduce(
      (acc, it) => {
        acc.calories += Number(it.calories) || 0;
        acc.protein += Number(it.protein) || 0;
        acc.carbs += Number(it.carbs) || 0;
        acc.fat += Number(it.fat) || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [items]);

  const handleUpdateQuantity = (itemIndex, newAmount, newUnit) => {
    const item = items[itemIndex];
    if (!item) return;

    const unit = newUnit || item.unit || 'g';

    // Scale using base_food if present, or reconstruct base 100g values
    const baseFood = item.base_food || {
      name: item.food_name,
      brand: item.brand,
      serving_size: 100,
      serving_unit: 'g',
      calories: item.calories && item.amount ? (Number(item.calories) / Number(item.amount)) * 100 : 0,
      protein: item.protein && item.amount ? (Number(item.protein) / Number(item.amount)) * 100 : 0,
      carbs: item.carbs && item.amount ? (Number(item.carbs) / Number(item.amount)) * 100 : 0,
      fat: item.fat && item.amount ? (Number(item.fat) / Number(item.amount)) * 100 : 0,
    };

    const scaled = calculateFoodNutrients(baseFood, newAmount, unit);
    onUpdateItemAmount(itemIndex, {
      ...item,
      amount: newAmount,
      unit: unit,
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fat: scaled.fat,
      gram_weight: scaled.gramWeight,
      base_food: baseFood,
    });
  };

  return (
    <div className="surface-card rounded-xl border border-border p-4 space-y-3">
      {/* Meal Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Utensils className="w-3.5 h-3.5 text-primary" />
          </div>

          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={meal.meal_name}
                onChange={(e) => onRename(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingName(false); }}
                className="h-8 px-2.5 rounded-md bg-secondary/70 border border-border text-xs font-semibold focus:outline-none focus:border-primary/50"
                autoFocus
              />
              <div className="flex gap-1 overflow-x-auto py-1">
                {SUGGESTED_NAMES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { onRename(s); setIsEditingName(false); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
              title="Click to rename meal"
            >
              <span>{meal.meal_name || `Meal ${index + 1}`}</span>
              <span className="text-[10px] text-muted-foreground font-normal">(rename)</span>
            </button>
          )}
        </div>

        {/* Totals & Reorder Controls */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <Badge className="text-primary bg-primary/10 border-primary/20 text-xs font-mono">
            {Math.round(mealTotals.calories)} kcal · {Math.round(mealTotals.protein)}P / {Math.round(mealTotals.carbs)}C / {Math.round(mealTotals.fat)}F
          </Badge>

          <div className="flex items-center border border-border/70 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 hover:bg-secondary/50 transition-colors"
              title="Move meal up"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <div className="w-[1px] h-3 bg-border/50" />
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === totalMeals - 1}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 hover:bg-secondary/50 transition-colors"
              title="Move meal down"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Delete meal"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="py-6 text-center border border-dashed border-border/60 rounded-lg text-xs text-muted-foreground">
            No foods added to this meal yet. Click "Add Food" below.
          </div>
        ) : (
          items.map((it, itIdx) => (
            <NutritionItemRow
              key={it.id || `${it.food_id}-${itIdx}`}
              item={it}
              onUpdateQuantity={(newAmt, newUnit) => handleUpdateQuantity(itIdx, newAmt, newUnit)}
              onRemove={() => onRemoveItem(itIdx)}
            />
          ))
        )}
      </div>

      {/* Add Food Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPickerOpen(true)}
        className="w-full text-xs border-dashed"
      >
        <Plus className="w-3.5 h-3.5" /> Add Food to {meal.meal_name || `Meal ${index + 1}`}
      </Button>

      <FoodPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectFood={(foodItem) => {
          onAddItem(foodItem);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
