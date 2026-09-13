import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { MetricsService } from '@/services/metrics';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState, Button, Badge } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import {
  TrendingUp,
  Camera,
  Image as ImageIcon,
  Plus,
  Settings,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ProgressCompositionChart from '@/components/portal/ProgressCompositionChart';
import MeasurementsChart from '@/components/portal/MeasurementsChart';
import MetricsBaselineWizard from '@/components/portal/MetricsBaselineWizard';
import MetricsCheckInModal from '@/components/portal/MetricsCheckInModal';
import {
  getBaselineState,
  calculateDerived,
  getMissingMeasurements,
  getBodyFatMethodLabel,
  fmtNum,
  toNumber,
} from '@/lib/body-progress';

function Delta({ current, previous, unit }) {
  if (current == null || previous == null) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return <span className="text-[11px] text-muted-foreground/80 font-mono">No change</span>;
  return (
    <span className={cn('text-[11px] font-semibold font-mono', delta < 0 ? 'text-emerald-400' : 'text-amber-400')}>
      {delta > 0 ? '+' : ''}
      {delta} {unit}
    </span>
  );
}

function SummaryCard({ label, icon: Icon, value, unit, delta = null, note }) {
  return (
    <div className="surface-card p-5 rounded-xl border border-border/80">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <p className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground tabular-nums">
        {value} {unit && <span className="text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
      <div className="mt-2 flex items-center gap-2">{delta}</div>
      {note && <p className="text-[11px] text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

export default function ClientMetrics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [s, list] = await Promise.all([
        MetricsService.getClientMetricsState(user.self_client_id),
        MetricsService.listByClient(user.self_client_id),
      ]);
      setState(s);
      setMetrics(list || []);
    } catch (err) {
      console.error('Error loading client metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="Loading your body progress…" />;

  if (!user?.self_client_id) {
    return (
      <div className="max-w-2xl mx-auto mt-10">
        <ClientEmptyState
          icon={TrendingUp}
          title="Client Metrics Unavailable"
          description="This area is available once you're linked to a client profile."
        />
      </div>
    );
  }

  // ------------------------------------------------------------------
  const baseline = getBaselineState(state);
  const client = state?.client || {};
  const heightSource = toNumber(client?.height) || toNumber(baseline?.height) || null;

  const rows = [...metrics].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());
  const latest = rows[rows.length - 1] || null;
  const previous = rows[rows.length - 2] || null;
  const derivedLatest = latest ? calculateDerived(latest, heightSource) : null;

  const missingMeasurements = getMissingMeasurements(rows);
  const missingInfo = baseline.missingList;

  const deltaOf = (field) => {
    const cur = toNumber(latest?.[field]);
    const prev = toNumber(previous?.[field]);
    return { current: cur, previous: prev };
  };

  // Extract all photos from metric entries
  const allPhotos = [];
  metrics.forEach((m) => {
    if (Array.isArray(m.progress_photos)) {
      m.progress_photos.forEach((p) => allPhotos.push({ ...p, entry_date: m.entry_date }));
    }
  });

  // ------------------------------------------------------------------
  if (!baseline.complete) {
    return (
      <div className="space-y-8 animate-in fade-in duration-300">
        <div className="pb-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Metrics & Progress
            </h1>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Track body composition changes, circumference measurements, and physique transformation over time.
          </p>
        </div>

        <div className="surface-card p-8 lg:p-10 rounded-2xl border border-primary/20 relative overflow-hidden">
          <div className="absolute right-0 top-0 w-64 h-64 bg-primary/10 blur-3xl rounded-full pointer-events-none" />
          <div className="relative max-w-2xl">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-lg sm:text-xl font-display font-semibold text-foreground leading-snug">
              Let's set up your Body Progress Baseline
            </h2>
            <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
              A quick one-time setup so your progress photos and measurements have a clear starting
              point. You'll add your body info, estimate body fat from reference photos, and log
              circumference measurements — every step is skippable except the essentials.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {missingInfo.map((f) => (
                <Badge key={f} variant="warning" className="capitalize">
                  <AlertTriangle className="w-3 h-3" /> Missing: {f === 'sex' ? 'sex' : f}
                </Badge>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={() => setShowBaseline(true)}>
                <Sparkles className="w-4 h-4" /> Start Baseline Setup
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Takes about 2 minutes
              </span>
            </div>
          </div>
        </div>

        {metrics.length > 0 && (
          <p className="text-[12px] text-muted-foreground">
            You already have {metrics.length} measurement{metrics.length === 1 ? '' : 's'} on record —
            setting your baseline won't change them.
          </p>
        )}

        <MetricsBaselineWizard
          open={showBaseline}
          onClose={() => setShowBaseline(false)}
          clientId={user.self_client_id}
          state={state}
          onSaved={loadData}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Full dashboard
  const weight = deltaOf('weight');
  const bodyFat = deltaOf('body_fat');
  const leanDelta =
    latest && previous
      ? Math.round((derivedLatest?.leanMass - calculateDerived(previous, heightSource)?.leanMass) * 10) / 10
      : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Metrics & Progress
            </h1>
            {baseline.hasBaseline && <Badge>Baseline set</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Track body composition changes, circumference measurements, and physique transformation over time.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowBaseline(true)}>
            <Settings className="w-4 h-4" /> Edit Baseline
          </Button>
          <Button size="sm" onClick={() => setShowCheckIn(true)}>
            <Plus className="w-4 h-4" /> Add Check-in
          </Button>
        </div>
      </div>

      {/* Missing data warning */}
      {missingMeasurements.length > 0 && (
        <div className="surface-card p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Some measurements are missing
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Not tracked yet: {missingMeasurements.map((f) => f.replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowCheckIn(true)}>
            <Plus className="w-4 h-4" /> Add measurement
          </Button>
        </div>
      )}

      {/* Summary cards */}
      {latest && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Weight"
            icon={TrendingUp}
            value={fmtNum(latest.weight)}
            unit="kg"
            delta={<Delta current={weight.current} previous={weight.previous} unit="kg" />}
            note={previous ? `vs ${formatDate(previous.entry_date)}` : null}
          />
          <SummaryCard
            label="Body Fat"
            icon={Camera}
            value={latest.body_fat != null ? fmtNum(latest.body_fat) : '—'}
            unit={latest.body_fat != null ? '%' : null}
            delta={<Delta current={bodyFat.current} previous={bodyFat.previous} unit="%" />}
            note={latest.body_fat != null ? getBodyFatMethodLabel(latest.body_fat_method) || 'Measured' : 'Not entered yet'}
          />
          <SummaryCard
            label="Lean Mass"
            icon={Sparkles}
            value={derivedLatest?.leanMass != null ? derivedLatest.leanMass : '—'}
            unit={derivedLatest?.leanMass != null ? 'kg' : null}
            delta={
              derivedLatest?.leanMass != null && leanDelta != null ? (
                <span className={cn('text-[11px] font-semibold font-mono', leanDelta < 0 ? 'text-amber-400' : 'text-emerald-400')}>
                  {leanDelta > 0 ? '+' : ''}
                  {leanDelta} kg
                </span>
              ) : null
            }
            note={latest.body_fat != null ? 'Calculated from body fat' : 'Needs body fat value'}
          />
          <SummaryCard
            label="BMI"
            icon={TrendingUp}
            value={derivedLatest?.bmi != null ? derivedLatest.bmi : '—'}
            unit={null}
            note={heightSource ? `Height ${fmtNum(heightSource)} cm` : 'Needs height value'}
          />
        </div>
      )}

      {/* Composition + circumference charts */}
      <ProgressCompositionChart metrics={metrics} client={client} />
      <MeasurementsChart metrics={metrics} />

      {/* Latest circumference measurements */}
      {latest && (
        <div>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
              Latest Circumference Measurements
            </h2>
            <span className="text-xs text-muted-foreground font-mono">Recorded {formatDate(latest.entry_date)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {[
              { label: 'Body Fat', value: latest.body_fat != null ? `${fmtNum(latest.body_fat)}%` : null },
              { label: 'Waist', value: latest.waist != null ? `${fmtNum(latest.waist)} cm` : null },
              { label: 'Chest', value: latest.chest != null ? `${fmtNum(latest.chest)} cm` : null },
              { label: 'Arm (R)', value: latest.right_arm != null ? `${fmtNum(latest.right_arm)} cm` : null },
              { label: 'Thigh (R)', value: latest.right_thigh != null ? `${fmtNum(latest.right_thigh)} cm` : null },
              { label: 'Neck', value: latest.neck != null ? `${fmtNum(latest.neck)} cm` : null },
              { label: 'Hips', value: latest.hip != null ? `${fmtNum(latest.hip)} cm` : null },
              { label: 'Calf (R)', value: latest.right_calf != null ? `${fmtNum(latest.right_calf)} cm` : null },
              { label: 'Arm (L)', value: latest.left_arm != null ? `${fmtNum(latest.left_arm)} cm` : null },
              { label: 'Thigh (L)', value: latest.left_thigh != null ? `${fmtNum(latest.left_thigh)} cm` : null },
            ]
              .filter((item) => item.value != null)
              .map((item) => (
                <div key={item.label} className="surface-card p-4 rounded-xl border border-border/80">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground block">{item.label}</span>
                  <p className="text-base font-bold text-foreground font-mono mt-1">{item.value}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Progress photos gallery */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-primary" /> Progress Photos
          </h2>
        </div>
        {allPhotos.length === 0 ? (
          <ClientEmptyState
            icon={ImageIcon}
            title="No Progress Photos Yet"
            description="Your physique check-in photos will appear securely in this gallery once uploaded during check-ins."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {allPhotos.map((photo, idx) => (
              <div
                key={photo.id || idx}
                onClick={() => setSelectedPhoto(photo)}
                className="surface-card rounded-xl overflow-hidden border border-border/80 group cursor-pointer hover:border-primary/50 transition-all aspect-[3/4] relative bg-black/40"
              >
                {photo.signed_url ? (
                  <img
                    src={photo.signed_url}
                    alt={`${photo.angle || 'Progress'} photo`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                  <span className="text-[10px] font-semibold text-white uppercase tracking-wider block capitalize">
                    {photo.angle || 'Photo'}
                  </span>
                  <span className="text-[10px] text-gray-300 font-mono">{formatDate(photo.entry_date || photo.captured_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Measurement log history */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Measurement Log History
          </h2>
        </div>
        {metrics.length === 0 ? (
          <ClientEmptyState
            icon={TrendingUp}
            title="No History Entries"
            description="No measurements recorded yet. Entries will be chronologically listed here."
          />
        ) : (
          <div className="surface-card rounded-xl overflow-hidden border border-border/80">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/80 bg-secondary/30">
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Date</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Weight</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Body Fat</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Waist</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Method</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {[...metrics]
                    .sort((a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime())
                    .map((m) => (
                      <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {formatDate(m.entry_date)}
                          {m.is_baseline && <span className="ml-2 text-[10px] text-primary font-semibold uppercase">Baseline</span>}
                        </td>
                        <td className="px-4 py-3 text-primary font-bold">{m.weight != null ? `${fmtNum(m.weight)} kg` : '—'}</td>
                        <td className="px-4 py-3 text-foreground">{m.body_fat != null ? `${fmtNum(m.body_fat)}%` : '—'}</td>
                        <td className="px-4 py-3 text-foreground">{m.waist != null ? `${fmtNum(m.waist)} cm` : '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground font-sans text-[11px]">
                          {getBodyFatMethodLabel(m.body_fat_method) || '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-sans text-[11px] max-w-xs truncate">
                          {m.notes || '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox photo modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="max-w-md w-full surface-card p-3 rounded-2xl border border-border" onClick={(e) => e.stopPropagation()}>
            {selectedPhoto.signed_url && (
              <img src={selectedPhoto.signed_url} alt="Progress Photo" className="w-full rounded-xl max-h-[75vh] object-contain mx-auto" />
            )}
            <div className="p-3 text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary capitalize block">
                {selectedPhoto.angle || 'Progress'} Photo
              </span>
              <span className="text-xs text-muted-foreground font-mono mt-0.5 block">
                {formatDate(selectedPhoto.entry_date || selectedPhoto.captured_at)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <MetricsBaselineWizard
        open={showBaseline}
        onClose={() => setShowBaseline(false)}
        clientId={user.self_client_id}
        state={state}
        onSaved={loadData}
      />
      <MetricsCheckInModal
        open={showCheckIn}
        onClose={() => setShowCheckIn(false)}
        clientId={user.self_client_id}
        workspaceId={client.workspace_id}
        latest={latest}
        onSaved={loadData}
      />
    </div>
  );
}