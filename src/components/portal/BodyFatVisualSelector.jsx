import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BODY_FAT_SLIDER_THRESHOLDS,
  BODY_FAT_SLIDER_IMAGES,
} from '@/lib/body-progress';

const SEX_LABEL = { male: 'male', female: 'female' };

export default function BodyFatVisualSelector({
  sex = 'male',
  value = null,
  onChange,
  className = '',
}) {
  const thresholds = BODY_FAT_SLIDER_THRESHOLDS[sex] || BODY_FAT_SLIDER_THRESHOLDS.male;
  const images = BODY_FAT_SLIDER_IMAGES[sex] || BODY_FAT_SLIDER_IMAGES.male;

  const index = value == null ? -1 : thresholds.indexOf(value);
  // Effective index mirrors the range-slider default position so the reference
  // photo loads immediately on first render — even before the user interacts.
  const effectiveIndex = index >= 0 ? index : Math.max(0, Math.round((thresholds.length - 1) / 2));
  const effectiveValue = thresholds[effectiveIndex];
  const selectedImage = images[effectiveValue] || null;

  const handleSelect = (idx) => {
    if (idx >= 0 && idx < thresholds.length) onChange(thresholds[idx]);
  };

  const stepNext = () => handleSelect(index >= 0 ? index + 1 : effectiveIndex + 1);
  const stepPrev = () => handleSelect(index >= 0 ? index - 1 : effectiveIndex - 1);

  const sliderProps = useMemo(() => {
    const max = thresholds.length - 1;
    return {
      min: 0,
      max,
      value: effectiveIndex,
      onChange: (e) => handleSelect(parseInt(e.target.value, 10)),
    };
  }, [effectiveIndex, sex]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={stepPrev}
          disabled={effectiveIndex <= 0}
          aria-label="Previous body-fat photo"
          className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="relative w-40 sm:w-48 aspect-[3/4] rounded-xl overflow-hidden border border-black/10 bg-white">
          {selectedImage ? (
            <img
              src={selectedImage}
              alt={`${effectiveValue}% body fat reference — ${SEX_LABEL[sex]}`}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs px-4 text-center">
              Browse the photos to estimate body fat
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2">
            <span className="px-2 py-0.5 rounded-full bg-white/90 text-gray-900 border border-black/10 text-[12px] font-bold font-mono shadow-sm">
              {index >= 0 ? `${value}%` : `${effectiveValue}%`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={stepNext}
          disabled={effectiveIndex >= thresholds.length - 1}
          aria-label="Next body-fat photo"
          className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-4">
        <input
          type="range"
          min={sliderProps.min}
          max={sliderProps.max}
          step={1}
          value={sliderProps.value}
          onChange={sliderProps.onChange}
          aria-label="Body fat visual estimate"
          aria-valuetext={value != null ? `${value} percent body fat` : 'No selection'}
          className="w-full accent-primary cursor-pointer"
        />
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground/70 font-mono">
          <span>{thresholds[0]}%</span>
          <span className="text-primary font-medium">
            {value != null ? `${value}% selected` : 'Select a value'}
          </span>
          <span>{thresholds[thresholds.length - 1]}%</span>
        </div>
      </div>
    </div>
  );
}