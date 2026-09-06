import React from 'react';
import FoodQuantityInput from './FoodQuantityInput';
import { Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NutritionItemRow({
  item,
  onUpdateQuantity,
  onRemove,
}) {
  const numAmount = Number(item.amount);
  const isInvalid = !numAmount || numAmount <= 0 || isNaN(numAmount);

  // The base food item used for context-aware units and scaling
  const baseFood = item.base_food || {
    name: item.food_name,
    brand: item.brand,
    serving_unit: item.unit || 'g',
    serving_size: 100,
    calories: item.calories && item.amount ? (Number(item.calories) / Number(item.amount)) * 100 : 0,
    protein: item.protein && item.amount ? (Number(item.protein) / Number(item.amount)) * 100 : 0,
    carbs: item.carbs && item.amount ? (Number(item.carbs) / Number(item.amount)) * 100 : 0,
    fat: item.fat && item.amount ? (Number(item.fat) / Number(item.amount)) * 100 : 0,
  };

  return (
    <div className="group flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl bg-secondary/20 hover:bg-secondary/35 border border-border/50 hover:border-border transition-all">
      {/* 1. Food Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground truncate" title={item.food_name}>
            {item.food_name}
          </span>
          {item.brand && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary/60 border border-border/40 font-medium">
              {item.brand}
            </span>
          )}
        </div>

        {isInvalid ? (
          <div className="flex items-center gap-1 text-[11px] text-amber-400 mt-1">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Enter an amount greater than 0</span>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground/75 mt-0.5 font-mono">
            {baseFood.calories != null && (
              <span>100g base: {Math.round(baseFood.calories)} kcal</span>
            )}
          </div>
        )}
      </div>

      {/* 2. Unified Quantity Control & Macros */}
      <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap sm:flex-nowrap shrink-0">
        {/* Custom Quantity Stepper & Context Unit Selector */}
        <div className="shrink-0">
          <FoodQuantityInput
            amount={item.amount}
            unit={item.unit || 'g'}
            food={baseFood}
            size="sm"
            showGramBadge={true}
            onChange={({ amount: newAmount, unit: newUnit }) => {
              onUpdateQuantity?.(newAmount, newUnit);
            }}
          />
        </div>

        {/* Live Macro Breakdown */}
        <div className="flex items-center gap-1.5 shrink-0 bg-background/60 border border-border/40 rounded-lg px-2.5 py-1 font-mono text-xs">
          <div className="text-center px-1">
            <span className="text-[9px] uppercase font-sans text-muted-foreground/80 block leading-tight">Cal</span>
            <span className="font-semibold text-primary">{Math.round(item.calories || 0)}</span>
          </div>
          <div className="w-[1px] h-5 bg-border/40" />
          <div className="text-center px-1">
            <span className="text-[9px] uppercase font-sans text-muted-foreground/80 block leading-tight">P</span>
            <span className="text-foreground">{Math.round((item.protein || 0) * 10) / 10}g</span>
          </div>
          <div className="text-center px-1">
            <span className="text-[9px] uppercase font-sans text-muted-foreground/80 block leading-tight">C</span>
            <span className="text-foreground">{Math.round((item.carbs || 0) * 10) / 10}g</span>
          </div>
          <div className="text-center px-1">
            <span className="text-[9px] uppercase font-sans text-muted-foreground/80 block leading-tight">F</span>
            <span className="text-foreground">{Math.round((item.fat || 0) * 10) / 10}g</span>
          </div>
        </div>

        {/* Remove Button */}
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Remove food from meal"
          aria-label="Remove food"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
