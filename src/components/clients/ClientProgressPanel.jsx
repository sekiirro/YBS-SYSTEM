import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { MetricsService } from '@/services/metrics';
import { Button, Modal, Input, TextArea, Badge } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { toNumber, fmtNum, CIRCUMFERENCE_FIELDS, VALIDATION_RANGES } from '@/lib/body-progress';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  Scale,
  Activity,
  Ruler,
  Plus,
  Trash2,
  ChevronDown,
  RefreshCw,
  Calendar,
} from 'lucide-react';

const PERIODS = [
  { id: 'ALL', label: 'All time', days: null },
  { id: '3M', label: '3 months', days: 90 },
  { id: '1M', label: '30 days', days: 30 },
];

const MEASUREMENT_SERIES = [
  { key: 'waist', label: 'Waist', color: '#f472b6' },
  { key: 'chest', label: 'Chest', color: '#818cf8' },
  { key: 'hip', label: 'Hip', color: '#38bdf8' },
  { key: 'neck', label: 'Neck', color: '#a78bfa' },
  { key: 'right_arm', label: 'Arm (R)', color: '#34d399' },
  { key: 'left_arm', label: 'Arm (L)', color: '#2dd4bf' },
  { key: 'right_thigh', label: 'Thigh (R)', color: '#fbbf24' },
  { key: 'left_thigh', label: 'Thigh (L)', color: '#f59e0b' },
  { key: 'right_calf', label: 'Calf (R)', color: '#94a3b8' },
  { key: 'left_calf', label: 'Calf (L)', color: '#64748b' },
];

const FIELD_ORDER = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'body_fat', label: 'Body Fat', unit: '%' },
  ...CIRCUMFERENCE_FIELDS.map((k) => ({
    key: k,
    label: VALIDATION_RANGES[k]?.label || k,
    unit: 'cm',
  })),
];

const WEIGHT_COLOR = '#3b82f6';
const BODY_FAT_COLOR = '#8b5cf6';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );
  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mql) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

const sortAsc = (rows) =>
  [...(rows || [])].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function filterByPeriod(rows, period) {
  const p = PERIODS.find((x) => x.id === period);
  if (!p?.days) return rows;
  const cutoff = Date.now() - p.days * 86400000;
  return rows.filter((r) => new Date(`${r.entry_date}T00:00:00`).getTime() >= cutoff);
}

function DeltaChip({ delta, unit }) {
  if (delta == null) return null;
  const d = round1(delta);
  if (d == null) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full border',
        d <= 0
          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
          : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      )}
    >
      {d > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {d > 0 ? '+' : ''}
      {d} {unit}
    </span>
  );
}

function DeltaText({ prev, curr }) {
  if (curr == null) return null;
  if (prev == null) {
    return (
      <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
        New
      </span>
    );
  }
  const d = round1(curr - prev);
  if (d == null || Math.abs(d) < 0.05) {
    return <span className="text-[12px] text-muted-foreground">= 0</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
      {d > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {d > 0 ? '+' : ''}
      {d}
    </span>
  );
}

export default function ClientProgressPanel({ metrics, clientId, client, onUpdated }) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'metrics.update');
  const reduced = usePrefersReducedMotion();

  const [period, setPeriod] = useState('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [measure, setMeasure] = useState('waist');

  const allRows = useMemo(() => sortAsc(metrics), [metrics]);
  const filteredRows = useMemo(() => filterByPeriod(allRows, period), [allRows, period]);

  const latest = allRows[allRows.length - 1] || null;
  const first = allRows[0] || null;

  const latestWeight = latest ? toNumber(latest.weight) : null;
  const firstWeight = first ? toNumber(first.weight) : null;
  const latestBodyFat = latest ? toNumber(latest.body_fat) : null;
  const firstBodyFat = first ? toNumber(first.body_fat) : null;

  const weightDelta = latestWeight != null && firstWeight != null ? latestWeight - firstWeight : null;
  const bodyFatDelta = latestBodyFat != null && firstBodyFat != null ? latestBodyFat - firstBodyFat : null;

  const measureMeta = MEASUREMENT_SERIES.find((s) => s.key === measure) || MEASUREMENT_SERIES[0];
  const measureRows = filteredRows
    .map((r) => ({ date: r.entry_date, value: toNumber(r[measureMeta.key]) }))
    .filter((d) => d.value != null);
  const measureFirst = measureRows[0]?.value ?? null;
  const measureLast = measureRows[measureRows.length - 1]?.value ?? null;
  const measureDelta = measureFirst != null && measureLast != null ? measureLast - measureFirst : null;

  const handleDeleteEntry = async (metricId) => {
    if (!window.confirm('Delete this metrics entry? This cannot be undone.')) return;
    try {
      await MetricsService.delete(metricId);
      onUpdated();
    } catch (err) {
      console.error('Failed to delete metric:', err);
      window.alert(err.message || 'Failed to delete entry.');
    }
  };

  const weightData = filteredRows
    .filter((r) => toNumber(r.weight) != null)
    .map((r) => ({
      date: r.entry_date,
      weight: toNumber(r.weight),
      body_fat: toNumber(r.body_fat),
    }));
  const bodyFatData = filteredRows
    .filter((r) => toNumber(r.body_fat) != null)
    .map((r) => ({ date: r.entry_date, value: toNumber(r.body_fat) }));

  const weightPct =
    weightData.length > 1 && weightData[0].weight
      ? Math.round((weightData[weightData.length - 1].weight / weightData[0].weight - 1) * 1000) / 10
      : null;

  const weightDomain = (() => {
    const vals = weightData.map((d) => d.weight);
    if (!vals.length) return [0, 100];
    return [Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)];
  })();

  const renderHeader = (label, value, unit, chip) => (
    <div>
      <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2.5 mt-1 flex-wrap">
        <span className="text-2xl lg:text-5xl font-bold font-display tracking-tight text-foreground tabular-nums">
          {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
        </span>
        {chip}
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <h3 className="text-[14px] font-display font-semibold">Progress Metrics</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Weight, body composition and measurements over time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  period === p.id
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={onUpdated}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
            title="Refresh data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {canEdit && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" /> Add Entry
            </Button>
          )}
        </div>
      </div>

      {metrics === null ? (
        <PanelSkeleton />
      ) : allRows.length === 0 ? (
        <div className="py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-secondary/50 border border-border/60 flex items-center justify-center mx-auto mb-3 text-muted-foreground">
            <TrendingUp className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-foreground">No metrics recorded yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Progress charts appear once the first check-in or manual entry is logged.
          </p>
          {canEdit && (
            <Button className="mt-4" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" /> Add First Entry
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* KPI summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="p-4 rounded-xl border border-border/70 bg-secondary/[0.18]">
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-primary" /> Latest Check-in
              </span>
              <p className="text-3xl font-bold font-display tracking-tight mt-1.5 tabular-nums">
                {latest ? formatDate(latest.entry_date) : '—'}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {allRows.length} total {allRows.length === 1 ? 'entry' : 'entries'}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-border/70 bg-secondary/[0.18]">
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Scale className="w-3 h-3 text-primary" /> Current Weight
              </span>
              <p className="text-3xl font-bold font-display tracking-tight mt-1.5 tabular-nums">
                {latestWeight != null ? `${fmtNum(latestWeight)} kg` : '—'}
              </p>
              <div className="mt-1">
                <DeltaChip delta={weightDelta} unit="kg" />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/70 bg-secondary/[0.18]">
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-primary" /> Body Fat
              </span>
              <p className="text-3xl font-bold font-display tracking-tight mt-1.5 tabular-nums">
                {latestBodyFat != null ? `${fmtNum(latestBodyFat)}%` : '—'}
              </p>
              <div className="mt-1">
                <DeltaChip delta={bodyFatDelta} unit="%" />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/70 bg-secondary/[0.18]">
              <span className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3 text-primary" /> Change Since First
              </span>
              <p className="text-3xl font-bold font-display tracking-tight mt-1.5 tabular-nums">
                {weightPct != null ? `${weightPct > 0 ? '+' : ''}${weightPct}%` : '—'}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">of first recorded weight</p>
            </div>
          </div>

          {/* Weight + composition */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            {/* Weight trend */}
            <div className="lg:col-span-2 surface-card p-5 rounded-xl border border-border/80 glow-subtle">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                {renderHeader(
                  'Weight Trend',
                  weightData.length ? fmtNum(weightData[weightData.length - 1].weight) : '—',
                  'kg',
                  <DeltaChip delta={weightData.length > 1 ? weightData[weightData.length - 1].weight - weightData[0].weight : null} unit="kg" />
                )}
              </div>
              {weightData.length === 0 ? (
                <NoChartData
                  icon={Scale}
                  title="No weight data in this period"
                  hint="Check-ins and manual entries with weight fill this trend."
                />
              ) : weightData.length === 1 ? (
                <NoChartData
                  icon={Calendar}
                  title={`1 measurement logged (${fmtNum(weightData[0].weight)} kg)`}
                  hint="The trend line will emerge as future measurements are recorded."
                />
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weightData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ybsWeightGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={WEIGHT_COLOR} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={WEIGHT_COLOR} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => formatDate(d)}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        domain={weightDomain}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                              <p className="font-semibold text-foreground">{formatDate(d.date)}</p>
                              <p className="font-bold mt-0.5" style={{ color: WEIGHT_COLOR }}>
                                {d.weight} kg
                              </p>
                              {d.body_fat != null && (
                                <p className="text-muted-foreground text-[12px] mt-0.5">{d.body_fat}% Body Fat</p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="weight"
                        stroke={WEIGHT_COLOR}
                        strokeWidth={2.5}
                        fill="url(#ybsWeightGrad)"
                        isAnimationActive={!reduced}
                        dot={{ fill: WEIGHT_COLOR, strokeWidth: 2, r: 3.5, stroke: 'hsl(var(--background))' }}
                        activeDot={{ r: 5, fill: WEIGHT_COLOR, stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-2 border-t border-border/40 text-center">
                <MiniStat label="First" value={weightData.length ? `${fmtNum(weightData[0].weight)} kg` : '—'} />
                <MiniStat label="Latest" value={weightData.length ? `${fmtNum(weightData[weightData.length - 1].weight)} kg` : '—'} accent />
                <MiniStat
                  label="Absolute Δ"
                  value={weightData.length > 1 ? `${round1(weightData[weightData.length - 1].weight - weightData[0].weight)} kg` : '—'}
                />
                <MiniStat label="% Change" value={weightPct != null ? `${weightPct > 0 ? '+' : ''}${weightPct}%` : '—'} />
              </div>
            </div>

            {/* Body composition */}
            <div className="surface-card p-5 rounded-xl border border-border/80 glow-subtle">
              <div className="mb-5">
                {renderHeader(
                  'Body Composition',
                  bodyFatData.length ? `${fmtNum(bodyFatData[bodyFatData.length - 1].value)}%` : '—',
                  '',
                  <DeltaChip
                    delta={bodyFatData.length > 1 ? bodyFatData[bodyFatData.length - 1].value - bodyFatData[0].value : null}
                    unit="%"
                  />
                )}
              </div>
              {bodyFatData.length === 0 ? (
                <NoChartData
                  icon={Activity}
                  title="No body fat data"
                  hint="Body fat entries from check-ins unlock this composition trend."
                />
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={bodyFatData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => formatDate(d)}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                              <p className="font-semibold text-foreground">{formatDate(d.date)}</p>
                              <p className="font-bold mt-0.5" style={{ color: BODY_FAT_COLOR }}>
                                {d.value}%
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={BODY_FAT_COLOR}
                        strokeWidth={2.5}
                        isAnimationActive={!reduced}
                        dot={{ fill: BODY_FAT_COLOR, strokeWidth: 2, r: 3.5, stroke: 'hsl(var(--background))' }}
                        activeDot={{ r: 5, fill: BODY_FAT_COLOR, stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="text-[12px] text-muted-foreground mt-3">Body fat as a percentage of body weight.</p>
            </div>
          </div>

          {/* Body measurements */}
          <div className="surface-card p-5 rounded-xl border border-border/80 glow-subtle mb-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5">
              {renderHeader(
                'Body Measurements',
                measureLast != null ? `${fmtNum(measureLast)} cm` : '—',
                '',
                <DeltaChip delta={measureDelta} unit="cm" />
              )}
              <div className="flex flex-wrap items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50 max-w-full">
                {MEASUREMENT_SERIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setMeasure(s.key)}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                      measure === s.key
                        ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {measureRows.length === 0 ? (
              <NoChartData
                icon={Ruler}
                title={`No ${measureMeta.label.toLowerCase()} entries`}
                hint="Add this measurement during a check-in to start the trend."
              />
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={measureRows} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => formatDate(d)}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                            <p className="font-semibold text-foreground">{formatDate(d.date)}</p>
                            <p className="font-bold mt-0.5" style={{ color: measureMeta.color }}>
                              {d.value} cm — {measureMeta.label}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={measureMeta.color}
                      strokeWidth={2.5}
                      isAnimationActive={!reduced}
                      dot={{ fill: measureMeta.color, strokeWidth: 2, r: 3.5, stroke: 'hsl(var(--background))' }}
                      activeDot={{ r: 5, fill: measureMeta.color, stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Measurement history */}
          <div className="surface-card p-5 rounded-xl border border-border/80">
            <h4 className="text-[14px] font-display font-semibold mb-1 flex items-center gap-2">
              <Ruler className="w-4 h-4 text-primary" /> Measurement History
            </h4>
            <p className="text-[12px] text-muted-foreground mb-4">
              Every recorded entry in chronological order. Expand a check-in to see which values changed since the previous one.
            </p>
            {filteredRows.length === 0 ? (
              <p className="text-[14px] text-muted-foreground py-6 text-center">
                No entries in this period — switch to “All time” to see the full history.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredRows.map((m, idx) => {
                  const prev = filteredRows[idx - 1];
                  const changes = FIELD_ORDER.filter(({ key }) => {
                    const v = toNumber(m[key]);
                    if (v == null) return false;
                    const pv = prev ? toNumber(prev[key]) : null;
                    return pv == null || v !== pv;
                  });
                  const open = openId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'rounded-xl border border-border/70 bg-secondary/[0.18] overflow-hidden transition-colors',
                        open && 'border-primary/25'
                      )}
                    >
                      <button
                        onClick={() => setOpenId(open ? null : m.id)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                        aria-expanded={open}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 shrink-0 flex items-center justify-center">
                            <Calendar className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium">
                              {formatDate(m.entry_date)}
                              <span className="text-muted-foreground font-normal"> · Check-in #{idx + 1}</span>
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {changes.slice(0, 3).map(({ key, label }) => {
                                const v = toNumber(m[key]);
                                const pv = prev ? toNumber(prev[key]) : null;
                                const d = round1(v - pv);
                                const field = FIELD_ORDER.find((f) => f.key === key);
                                return (
                                  <span
                                    key={key}
                                    className="inline-flex items-center gap-0.5 text-[12px] px-1.5 py-0.5 rounded-full bg-secondary/40 border border-border/60 text-muted-foreground whitespace-nowrap"
                                  >
                                    {label}
                                    {pv == null ? ' new' : `${d > 0 ? ' +' : ' '}${d} ${field?.unit || ''}`}
                                  </span>
                                );
                              })}
                              {changes.length > 3 && (
                                <span className="text-[12px] px-1.5 py-0.5 rounded-full bg-secondary/40 text-muted-foreground">
                                  +{changes.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.ai_analysis && <Badge className="text-primary bg-primary/10 border-primary/20">AI Analyzed</Badge>}
                          {canEdit && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEntry(m.id);
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <ChevronDown
                            className={cn('w-4 h-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
                          />
                        </div>
                      </button>
                      {open && (
                        <div className="border-t border-border/60 px-4 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {FIELD_ORDER.map(({ key, label, unit }) => {
                              const val = toNumber(m[key]);
                              const prevVal = prev ? toNumber(prev[key]) : null;
                              const changed = val != null && (prevVal == null || val !== prevVal);
                              return (
                                <div
                                  key={key}
                                  className={cn(
                                    'p-2.5 rounded-lg bg-secondary/20 border border-transparent',
                                    changed && 'border-primary/15 bg-primary/[0.06]'
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</span>
                                    <DeltaText prev={prevVal} curr={val} />
                                  </div>
                                  <p className="text-[14px] font-medium tabular-nums mt-1" dir="auto">
                                    {val == null ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : (
                                      `${fmtNum(val)} ${unit}`
                                    )}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                          {m.notes && (
                            <p className="text-[12px] text-muted-foreground mt-4 pt-3 border-t border-border/60" dir="auto">
                              <span className="font-medium text-foreground/90">Notes: </span>
                              {m.notes}
                            </p>
                          )}
                          {Array.isArray(m.progress_photos) && m.progress_photos.length > 0 && (
                            <div className="mt-4">
                              <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-2">
                                Progress photos ({m.progress_photos.length})
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {m.progress_photos.map((p) => (
                                  <img
                                    key={p.id}
                                    src={p.signed_url || ''}
                                    alt={p.angle || 'Progress photo'}
                                    className="w-16 h-16 object-cover rounded-lg border border-border/60"
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showAdd && (
        <AddMetricModal
          clientId={clientId}
          workspaceId={client?.workspace_id}
          assignedCoachId={user?.id || client?.assigned_ybs_coach_id}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            onUpdated();
          }}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value, accent = false }) {
  return (
    <div>
      <span className="text-[12px] uppercase font-semibold text-muted-foreground block">{label}</span>
      <span className={cn('text-sm font-bold font-mono', accent ? 'text-primary' : 'text-foreground')}>{value}</span>
    </div>
  );
}

function NoChartData({ icon: Icon, title, hint }) {
  return (
    <div className="h-56 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border/50 rounded-lg">
      <Icon className="w-6 h-6 text-muted-foreground mb-2" />
      <p className="text-xs text-foreground font-medium">{title}</p>
      {hint && <p className="text-[12px] text-muted-foreground mt-0.5 max-w-xs">{hint}</p>}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading progress metrics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-secondary/30 border border-border/60 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 h-64 rounded-xl bg-secondary/30 border border-border/60 animate-pulse" />
        <div className="h-64 rounded-xl bg-secondary/30 border border-border/60 animate-pulse" />
      </div>
      <div className="h-56 rounded-xl bg-secondary/30 border border-border/60 animate-pulse" />
    </div>
  );
}

function AddMetricModal({ clientId, workspaceId, assignedCoachId, onClose, onSaved }) {
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    weight: '',
    body_fat: '',
    chest: '',
    waist: '',
    hip: '',
    right_arm: '',
    left_arm: '',
    right_thigh: '',
    left_thigh: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const data = {
        ...form,
        client_id: clientId,
        workspace_id: workspaceId || undefined,
        assigned_ybs_coach_id: assignedCoachId || undefined,
      };
      Object.keys(data).forEach((k) => {
        if (data[k] === '' || data[k] == null) delete data[k];
        if (typeof data[k] === 'string' && k !== 'entry_date' && k !== 'notes' && data[k] !== '') data[k] = parseFloat(data[k]);
      });
      await MetricsService.create(data);
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Metrics Entry" size="lg">
      <div className="space-y-4">
        <Input label="Date" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label="Weight (kg)" type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          <Input label="Body Fat %" type="number" value={form.body_fat} onChange={(e) => setForm({ ...form, body_fat: e.target.value })} />
          <Input label="Chest (cm)" type="number" value={form.chest} onChange={(e) => setForm({ ...form, chest: e.target.value })} />
          <Input label="Waist (cm)" type="number" value={form.waist} onChange={(e) => setForm({ ...form, waist: e.target.value })} />
          <Input label="Hip (cm)" type="number" value={form.hip} onChange={(e) => setForm({ ...form, hip: e.target.value })} />
          <Input label="R Arm (cm)" type="number" value={form.right_arm} onChange={(e) => setForm({ ...form, right_arm: e.target.value })} />
          <Input label="L Arm (cm)" type="number" value={form.left_arm} onChange={(e) => setForm({ ...form, left_arm: e.target.value })} />
          <Input label="R Thigh (cm)" type="number" value={form.right_thigh} onChange={(e) => setForm({ ...form, right_thigh: e.target.value })} />
          <Input label="L Thigh (cm)" type="number" value={form.left_thigh} onChange={(e) => setForm({ ...form, left_thigh: e.target.value })} />
        </div>
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</Button>
        </div>
      </div>
    </Modal>
  );
}
