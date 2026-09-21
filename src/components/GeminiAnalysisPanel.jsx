import React, { useState } from 'react';
import { getNutritionAnalysis, getTrainingAnalysis, AIAnalysisError } from '@/services/aiAnalysis';
import { Button } from '@/components/ui';
import { Sparkles, RefreshCw, AlertCircle, ExternalLink, Zap, Activity, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Gemini AI analysis panel for a client's submitted form.
 *
 * Calls the summarize-nutrition / summarize-training edge function scoped to the
 * signed-in coach's own session (RLS-authorized), which serves cached results
 * when the input is unchanged, otherwise generates and stores a fresh one.
 */
export default function GeminiAnalysisPanel({ assessmentId, analysisType, clientName, className }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const isNutrition = analysisType === 'nutrition';

  const run = async () => {
    if (!assessmentId) {
      setError({ message: 'This tab requires a submitted form.', code: 'no_submission' });
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fn = isNutrition ? getNutritionAnalysis : getTrainingAnalysis;
      const data = await fn(assessmentId);
      setResult(data);
    } catch (err) {
      if (err instanceof AIAnalysisError) {
        setError({ message: err.message, code: err.code });
      } else {
        setError({ message: 'AI analysis is currently unavailable. Please try again.', code: 'ai_unavailable' });
      }
    } finally {
      setLoading(false);
    }
  };

  if (!assessmentId) {
    return <NoAnalysisState icon={Sparkles} message="Your client has not submitted the required form yet." />;
  }

  if (error) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="surface-card p-6 rounded-xl border border-red-500/25 bg-red-500/[0.03] text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
          <p className="text-sm font-medium text-foreground">{error.message}</p>
          {error.code !== 'no_submission' && (
            <Button
              variant="outline"
              size="sm"
              onClick={run}
              className="mt-4 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="surface-card p-8 rounded-xl border border-border/80 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-sm font-display font-semibold text-foreground">
            Generate {isNutrition ? 'Nutrition' : 'Training'} Analysis
          </h3>
          <p className="text-[12px] text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
            Gemini will review {clientName ? `${clientName}'s` : 'your client’s'} submitted answers and produce a
            personalized {isNutrition ? 'nutrition' : 'training'} assessment with coaching
            recommendations. Results are cached — regenerating only happens when the submission changes.
          </p>
          <Button
            size="sm"
            className="mt-4 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            onClick={run}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate AI Analysis
          </Button>
        </div>
      </div>
    );
  }

  const a = result.analysis || {};
  const sources = result.sources || [];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Analysis Header */}
      <div className="surface-card rounded-xl border border-border/80 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-border/60 bg-secondary/20">
          <div className="flex items-center gap-2">
            {isNutrition ? (
              <Bot className="w-4 h-4 text-primary shrink-0" />
            ) : (
              <Activity className="w-4 h-4 text-primary shrink-0" />
            )}
            <span className="text-[14px] font-semibold text-foreground">
              Gemini {isNutrition ? 'Nutrition' : 'Training'} Assessment
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {result.cached && (
              <span className="text-[12px] text-muted-foreground bg-secondary/70 px-2 py-0.5 rounded-full border border-border/40">
                Cached · {result.model}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2.5 text-muted-foreground hover:text-foreground"
              onClick={run}
              disabled={loading}
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Regenerate
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-6">
          {/* Summary */}
          <div>
            <SectionLabel>Client Summary</SectionLabel>
            <p className="text-[14px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {a.clientSummary || 'No summary returned.'}
            </p>
          </div>

          {/* Key Points */}
          {Array.isArray(a.keyPoints) && a.keyPoints.length > 0 && (
            <div>
              <SectionLabel>Key Assessment Points</SectionLabel>
              <ul className="space-y-1.5">
                {a.keyPoints.map((k, i) => (
                  <li key={i} className="flex items-start gap-2 text-[14px] text-foreground/90 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Nutrition Targets / Program */}
          {isNutrition ? <NutritionBody analysis={a} /> : <TrainingBody analysis={a} />}

          {/* Coaching Calls to Action */}
          {Array.isArray(a.coaching) && a.coaching.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-2">
              <SectionLabel accent>Coaching Next Steps</SectionLabel>
              <ul className="space-y-1.5">
                {a.coaching.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-[14px] text-foreground/90 leading-relaxed">
                    <Zap className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <div className="pt-3 border-t border-border/50">
              <SectionLabel>Sources</SectionLabel>
              <ul className="space-y-1.5">
                {sources.map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline underline-offset-2 truncate max-w-full">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, accent }) {
  return (
    <p
      className={cn(
        'text-[12px] uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5',
        accent ? 'text-amber-500' : 'text-primary'
      )}
    >
      {children}
    </p>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3 text-center">
      <p className="text-base font-mono font-bold text-foreground">{value}</p>
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function NutritionBody({ analysis }) {
  const n = analysis.nutrition || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Calories / Day', value: n.caloriesTarget ?? '—' },
          { label: 'Protein (g)', value: n.protein ?? '—' },
          { label: 'Carbs (g)', value: n.carbs ?? '—' },
          { label: 'Fat (g)', value: n.fat ?? '—' },
        ].map((s) => (
          <Stat key={s.label} label={s.label} value={`${s.value}`} />
        ))}
      </div>

      <KeywordList label="Foods to Include" items={n.foodsToInclude} />
      <KeywordList label="Foods to Limit" items={n.foodsToLimit} tone="limit" />

      {Array.isArray(n.mealTiming) && n.mealTiming.length > 0 && (
        <KeywordList label="Meal Timing Around Training" items={n.mealTiming} bullets />
      )}

      {n.hydrationLiters != null && (
        <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
          <span className="font-semibold text-foreground">Hydration target:</span> ~{n.hydrationLiters}L per day.
        </p>
      )}

      {Array.isArray(n.supplements) && n.supplements.length > 0 && (
        <KeywordList label="Supported Supplements" items={n.supplements} bullets />
      )}
    </div>
  );
}

function TrainingBody({ analysis }) {
  const p = analysis.program || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Split', value: p.recommendedSplit || '—' },
          { label: 'Days / Week', value: p.weeklyFrequency || '—' },
          { label: 'Session Length', value: p.sessionLength || '—' },
          { label: 'Volume', value: p.sessionVolume || '—' },
        ].map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      <KeywordList label="Priority Focus Areas" items={p.focusAreas} bullets />

      {p.exerciseRecommendations?.length > 0 && (
        <KeywordList label="Exercise Recommendations" items={p.exerciseRecommendations} bullets />
      )}

      {p.progression && (
        <BlockQuote title="Progression Plan" text={p.progression} />
      )}
      {p.techniqueCues?.length > 0 && (
        <KeywordList label="Technique Cues" items={p.techniqueCues} bullets />
      )}
      {p.injuryConsiderations?.length > 0 && (
        <KeywordList label="Injury Considerations" items={p.injuryConsiderations} tone="limit" bullets />
      )}
      {p.recoveryAndRest?.length > 0 && (
        <KeywordList label="Recovery & Rest" items={p.recoveryAndRest} bullets />
      )}
    </div>
  );
}

function KeywordList({ label, items, tone, bullets }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <SectionLabel accent={tone === 'limit'}>{label}</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) =>
          bullets ? (
            <span key={i} className="text-[12px] text-foreground/90 leading-relaxed w-full flex items-start gap-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', tone === 'limit' ? 'bg-amber-400' : 'bg-emerald-400')} />
              {item}
            </span>
          ) : (
            <span
              key={i}
              className={cn(
                'inline-flex items-center text-xs px-2.5 py-1 rounded-lg border',
                tone === 'limit'
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-100/95'
                  : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-100/95'
              )}
            >
              {item}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function BlockQuote({ title, text }) {
  if (!text) return null;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4">
      <SectionLabel>{title}</SectionLabel>
      <p className="text-[14px] text-foreground/90 leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function NoAnalysisState({ icon: Icon, message }) {
  return (
    <div className="surface-card p-6 rounded-xl text-center border border-border/80">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-secondary/60 border border-border/60 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-[14px] text-muted-foreground">{message}</p>
    </div>
  );
}