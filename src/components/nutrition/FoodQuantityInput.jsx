import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  getAvailableUnitsForFood,
  resolveFoodUnit,
  convertQuantityBetweenUnits,
  getGramEquivalentText,
} from '@/lib/nutritionUnits';
import { Minus, Plus, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FoodQuantityInput({
  amount = 100,
  unit = 'g',
  food = null,
  onChange,
  size = 'md',
  showGramBadge = true,
  disabled = false,
  className = '',
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Available context-aware units for this specific food
  const units = useMemo(() => getAvailableUnitsForFood(food), [food]);

  // Current unit configuration
  const currentUnitConfig = useMemo(() => resolveFoodUnit(food, unit), [food, unit]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  // Step increment / decrement handlers
  const handleStep = (direction) => {
    if (disabled) return;
    const step = currentUnitConfig.step || 1;
    const min = currentUnitConfig.min || 0.1;
    const currentNum = Number(amount) || 0;

    let nextVal;
    if (direction === 'up') {
      nextVal = currentNum + step;
    } else {
      nextVal = Math.max(min, currentNum - step);
    }

    // Format to avoid floating point precision issues
    if (step >= 1) {
      nextVal = Math.round(nextVal);
    } else if (step >= 0.1) {
      nextVal = Math.round(nextVal * 10) / 10;
    } else {
      nextVal = Math.round(nextVal * 100) / 100;
    }

    onChange?.({ amount: nextVal, unit: currentUnitConfig.id });
  };

  // Direct manual input change
  const handleInputChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange?.({ amount: '', unit: currentUnitConfig.id });
      return;
    }
    const parsed = parseFloat(raw);
    onChange?.({
      amount: isNaN(parsed) ? raw : parsed,
      unit: currentUnitConfig.id,
    });
  };

  const handleInputBlur = () => {
    const currentNum = Number(amount);
    const min = currentUnitConfig.min || 0.1;
    if (isNaN(currentNum) || currentNum < min) {
      onChange?.({ amount: currentUnitConfig.defaultAmount || min, unit: currentUnitConfig.id });
    }
  };

  // Unit switch with seamless quantity conversion
  const handleSelectUnit = (newUnit) => {
    setDropdownOpen(false);
    if (newUnit.id === currentUnitConfig.id) return;

    const convertedAmount = convertQuantityBetweenUnits(
      currentUnitConfig.id,
      newUnit.id,
      amount,
      food
    );

    onChange?.({ amount: convertedAmount, unit: newUnit.id });
  };

  // Gram equivalent badge text (e.g. "~200g")
  const gramEquivalent = showGramBadge
    ? getGramEquivalentText(amount, currentUnitConfig.id, food)
    : null;

  const isSmall = size === 'sm';
  const minVal = currentUnitConfig.min || 0.1;
  const isAtMin = Number(amount) <= minVal;

  return (
    <div className={cn('relative inline-flex items-center gap-1.5 select-none', className)} ref={containerRef}>
      {/* Unified Control Container */}
      <div
        className={cn(
          'inline-flex items-stretch rounded-lg border bg-background/90 text-foreground transition-all',
          'border-border/70 hover:border-border focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25',
          disabled && 'opacity-60 pointer-events-none',
          isSmall ? 'h-8 text-xs' : 'h-9 text-[13px]'
        )}
      >
        {/* Decrement Button */}
        <button
          type="button"
          onClick={() => handleStep('down')}
          disabled={disabled || isAtMin}
          aria-label="Decrease quantity"
          title={`Decrease by ${currentUnitConfig.step || 1} ${currentUnitConfig.label}`}
          className={cn(
            'flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary',
            'disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent rounded-l-[7px]',
            isSmall ? 'w-6 px-1' : 'w-7 px-1.5'
          )}
        >
          <Minus className={cn(isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5')} strokeWidth={2.5} />
        </button>

        {/* Custom Number Input (native spinners completely removed) */}
        <div className="relative flex items-center justify-center">
          <input
            ref={inputRef}
            type="number"
            min={minVal}
            step={currentUnitConfig.step || 1}
            value={amount}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            disabled={disabled}
            className={cn(
              'h-full bg-transparent text-center font-mono font-medium focus:outline-none',
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              isSmall ? 'w-12 px-1 text-xs' : 'w-14 px-1.5 text-[13px]'
            )}
          />
        </div>

        {/* Increment Button */}
        <button
          type="button"
          onClick={() => handleStep('up')}
          disabled={disabled}
          aria-label="Increase quantity"
          title={`Increase by ${currentUnitConfig.step || 1} ${currentUnitConfig.label}`}
          className={cn(
            'flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary',
            'disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent',
            isSmall ? 'w-6 px-1' : 'w-7 px-1.5'
          )}
        >
          <Plus className={cn(isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5')} strokeWidth={2.5} />
        </button>

        {/* Vertical Separator */}
        <div className="w-[1px] bg-border/60 my-1" />

        {/* Intelligent Unit Selector Trigger */}
        <button
          type="button"
          onClick={() => !disabled && setDropdownOpen((prev) => !prev)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1 font-mono font-medium rounded-r-[7px] transition-colors',
            'hover:bg-secondary/50 active:bg-secondary text-foreground/90 hover:text-foreground',
            isSmall ? 'px-2 text-xs' : 'px-2.5 text-[12px]'
          )}
          title="Change quantity unit"
        >
          <span className="truncate max-w-[70px]">{currentUnitConfig.label}</span>
          <ChevronDown
            className={cn(
              'text-muted-foreground transition-transform duration-150',
              dropdownOpen && 'rotate-180',
              isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'
            )}
          />
        </button>
      </div>

      {/* Normalized Gram Indicator Badge (e.g. "~200g") */}
      {gramEquivalent && (
        <span
          className={cn(
            'inline-flex items-center font-mono text-muted-foreground/80 bg-secondary/40 border border-border/40 rounded px-1.5 py-0.5 whitespace-nowrap select-none',
            isSmall ? 'text-[10px]' : 'text-[11px]'
          )}
          title={`Normalized equivalent: ${gramEquivalent} calculated from 100g base nutrition`}
        >
          {gramEquivalent}
        </span>
      )}

      {/* Context-Aware Units Dropdown Menu */}
      {dropdownOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1.5 z-50 min-w-[170px] rounded-xl border border-border bg-popover/95 p-1 backdrop-blur-md shadow-xl animate-in fade-in-50 zoom-in-95',
            'divide-y divide-border/30'
          )}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-sans">
            Units for {food?.name ? food.name.split(' ')[0] : 'Food'}
          </div>
          <div className="py-1 max-h-48 overflow-y-auto space-y-0.5">
            {units.map((u) => {
              const isSelected = u.id === currentUnitConfig.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleSelectUnit(u)}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-foreground/90 hover:bg-secondary/70 hover:text-foreground'
                  )}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="capitalize">{u.label}</span>
                    {u.gramPerUnit > 1 && u.id !== 'g' && (
                      <span className="text-[10px] text-muted-foreground block font-mono">
                        ≈ {u.gramPerUnit}g
                      </span>
                    )}
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
