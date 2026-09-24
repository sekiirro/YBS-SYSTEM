import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BODY_FAT_SLIDER_IMAGES, BODY_FAT_SLIDER_THRESHOLDS } from '@/lib/body-progress';

const SEX_LABEL = { male: 'male', female: 'female' };

export default function BodyFatVisualSelector({ sex = 'male', value = null, onChange, className = '' }) {
  const thresholds = BODY_FAT_SLIDER_THRESHOLDS[sex] || BODY_FAT_SLIDER_THRESHOLDS.male;
  const images = BODY_FAT_SLIDER_IMAGES[sex] || BODY_FAT_SLIDER_IMAGES.male;
  const selectedIndex = value == null ? -1 : thresholds.indexOf(value);
  const [expanded, setExpanded] = useState(value != null);
  const [visibleImage, setVisibleImage] = useState(value == null ? null : images[value]);
  const [imageReady, setImageReady] = useState(value != null);

  useEffect(() => {
    if (value == null) {
      setVisibleImage(null);
      setImageReady(false);
      return;
    }
    setExpanded(true);
    setImageReady(false);
    const next = new Image();
    next.src = images[value];
    next.onload = () => {
      setVisibleImage(images[value]);
      requestAnimationFrame(() => setImageReady(true));
    };
  }, [images, value]);

  const selectedValue = selectedIndex >= 0 ? thresholds[selectedIndex] : null;
  const message = useMemo(
    () => selectedValue == null
      ? 'Choose the closest visual reference. This is an estimate, not a clinical measurement.'
      : `${selectedValue}% selected as your visual estimate.`,
    [selectedValue]
  );

  const selectValue = (nextValue) => {
    setExpanded(true);
    onChange(nextValue);
  };

  const move = (direction) => {
    const start = selectedIndex >= 0 ? selectedIndex : Math.floor(thresholds.length / 2);
    const nextIndex = Math.min(thresholds.length - 1, Math.max(0, start + direction));
    selectValue(thresholds[nextIndex]);
  };

  return (
    <section className={cn('body-fat-stage', expanded && 'is-expanded', selectedValue != null && 'has-selection', className)}>
      <div className="body-fat-stage__media" aria-hidden="true">
        <video className="body-fat-stage__video" src="/videos/body-fat-estimation.mp4" autoPlay muted loop playsInline preload="metadata" />
        {visibleImage && (
          <img key={visibleImage} src={visibleImage} alt="" className={cn('body-fat-stage__image', imageReady && 'is-visible')} />
        )}
        <div className="body-fat-stage__blend" />
      </div>

      <div className="body-fat-stage__copy">
        <p>YBS · Body composition</p>
        <h3>{selectedValue == null ? <>Measure the truth.<br /><span>Build the legend.</span></> : <><span>{selectedValue}%</span> body fat</>}</h3>
        <small>{message}</small>
      </div>

      <div className="body-fat-stage__controller">
        {!expanded ? (
          <button type="button" className="body-fat-stage__launch" onClick={() => setExpanded(true)}>
            <span>Calculate your body fat</span><ArrowRight aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="body-fat-stage__rail" role="radiogroup" aria-label="Body fat visual estimate">
              {thresholds.map((percentage) => (
                <button type="button" role="radio" aria-checked={selectedValue === percentage} key={percentage} onClick={() => selectValue(percentage)} className={cn('body-fat-stage__option', selectedValue === percentage && 'is-selected')}>
                  <span>{percentage}</span><small>%</small>
                </button>
              ))}
            </div>
            <div className="body-fat-stage__controls">
              <button type="button" onClick={() => move(-1)} disabled={selectedIndex === 0} aria-label="Previous body-fat reference"><ChevronLeft aria-hidden="true" /></button>
              <p aria-live="polite">{message}</p>
              <button type="button" onClick={() => move(1)} disabled={selectedIndex === thresholds.length - 1} aria-label="Next body-fat reference"><ChevronRight aria-hidden="true" /></button>
              <button type="button" className="body-fat-stage__reset" onClick={() => { onChange(null); setExpanded(false); setVisibleImage(null); setImageReady(false); }} aria-label="Return to introduction"><RotateCcw aria-hidden="true" /></button>
            </div>
          </>
        )}
      </div>
      <span className="sr-only">Visual references shown are for a {SEX_LABEL[sex]} body.</span>
    </section>
  );
}
