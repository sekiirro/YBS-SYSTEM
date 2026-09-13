import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Activity, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/ybs-utils';
import { calculateDerived, toNumber } from '@/lib/body-progress';

const METRICS = {
  weight: { label: 'Weight', unit: 'kg', color: '#818cf8' },
  body_fat: { label: 'Body Fat', unit: '%', color: '#f472b6' },
  lean_mass: { label: 'Lean Mass', unit: 'kg', color: '#34d399' },
  ffmi: { label: 'FFMI', unit: '', color: '#38bdf8' },
};

const PERIODS = [
  { id: '4W', label: '4W', days: 28 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 182 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: 'ALL', label: 'ALL', days: null },
];

function seriesValue(metric, row, heightSource) {
  if (metric === 'weight' || metric === 'body_fat') return toNumber(row?.[metric]);
  const derived = calculateDerived(row, heightSource);
  if (metric === 'lean_mass') return derived.leanMass;
  if (metric === 'ffmi') return derived.ffmi;
  return null;
}

function seriesDelta(metric, rows, heightSource) {
  const valid = rows.filter((r) => seriesValue(metric, r, heightSource) != null);
  if (valid.length < 2) return null;
  const first = seriesValue(metric, valid[0], heightSource);
  const last = seriesValue(metric, valid[valid.length - 1], heightSource);
  return { first, last, delta: Math.round((last - first) * 10) / 10 };
}

export default function ProgressCompositionChart({ metrics = [], client = null }) {
  const [metric, setMetric] = useState('weight');
  const [period, setPeriod] = useState('ALL');

  const heightSource = client?.height || null;

  const sortAsc = (rows) =>
    [...(rows || [])].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

  const allRows = useMemo(() => sortAsc(metrics), [metrics]);

  const chartData = useMemo(() => {
    let rows = allRows.filter((r) => seriesValue(metric, r, heightSource) != null);
    if (period !== 'ALL') {
      const days = PERIODS.find((p) => p.id === period)?.days || 90;
      const cutoff = Date.now() - days * 86400000;
      rows = rows.filter((r) => new Date(`${r.entry_date}T00:00:00`).getTime() >= cutoff);
    }
    return rows.map((r) => ({
      date: r.entry_date,
      value: seriesValue(metric, r, heightSource),
    }));
  }, [allRows, metric, period, heightSource]);

  const meta = METRICS[metric];

  const stats = useMemo(() => (chartData.length ? seriesDelta(metric, chartData, heightSource) : null), [chartData, metric, heightSource]);

  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 1];
    const values = chartData.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.15 || 1;
    if (metric === 'ffmi') return [min > 4 ? min - pad : 0, max + pad];
    return [Math.max(0, min - pad), max + pad];
  }, [chartData, metric]);

  const deltaDisplay = stats && stats.delta !== 0 ? { ...stats.delta > 0 ? { positive: true } : {}, delta: stats.delta } : null;

  return (
    <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80 glow-subtle">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Body Composition
          </span>
          {stats && (
            <div className="flex items-baseline gap-2.5 mt-1">
              <span className="text-2xl lg:text-3xl font-bold font-display tracking-tight text-foreground tabular-nums">
                {stats.last} <span className="text-sm font-normal text-muted-foreground">{meta.unit}</span>
              </span>
              {deltaDisplay && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full border',
                    deltaDisplay.positive
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                  )}
                >
                  {deltaDisplay.delta > 0 ? '+' : ''}
                  {deltaDisplay.delta}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50">
            {Object.entries(METRICS).map(([key, m]) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  metric === key ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  period === p.id ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-56 sm:h-64 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-border/50 rounded-lg">
            <Calendar className="w-6 h-6 text-muted-foreground mb-2" />
            <p className="text-xs text-foreground font-medium">No {meta.label.toLowerCase()} data in this period</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {metric === 'body_fat' || metric === 'lean_mass'
                ? 'Body fat entries unlock lean mass and FFMI.'
                : 'Add a measurement to see the trend.'}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis domain={yDomain} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                      <p className="font-semibold text-foreground">{formatDate(d.date)}</p>
                      <p className="mt-0.5 font-bold" style={{ color: meta.color }}>
                        {d.value} {meta.unit}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={meta.color}
                strokeWidth={2.5}
                dot={{ fill: meta.color, strokeWidth: 2, r: 3.5, stroke: 'hsl(var(--background))' }}
                activeDot={{ r: 5, fill: meta.color, stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {metric === 'lean_mass' || metric === 'ffmi' ? (
        <p className="text-[11px] text-muted-foreground mt-4">
          Calculated from your weight + body fat + height values.
        </p>
      ) : null}
    </div>
  );
}