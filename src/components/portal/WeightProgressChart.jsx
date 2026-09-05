import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { TrendingDown, TrendingUp, Scale, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/ybs-utils';

export default function WeightProgressChart({ metrics = [], client = null }) {
  const [period, setPeriod] = useState('ALL'); // '7D' | '1M' | '3M' | 'ALL'

  // Filter and sort metrics chronologically for the chart
  const chartData = useMemo(() => {
    const valid = (metrics || [])
      .filter((m) => m.weight != null && !isNaN(Number(m.weight)))
      .map((m) => ({
        date: m.entry_date,
        weight: Number(m.weight),
        body_fat: m.body_fat ? Number(m.body_fat) : null,
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (period === 'ALL') return valid;

    const now = new Date();
    const daysLimit = period === '7D' ? 7 : period === '1M' ? 30 : 90;
    const cutoff = new Date(now.setDate(now.getDate() - daysLimit));

    return valid.filter((d) => new Date(d.date) >= cutoff);
  }, [metrics, period]);

  // Compute key stats
  const stats = useMemo(() => {
    const allSorted = (metrics || [])
      .filter((m) => m.weight != null && !isNaN(Number(m.weight)))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (allSorted.length === 0) return null;

    const starting = allSorted[0].weight;
    const current = allSorted[allSorted.length - 1].weight;
    const delta = Math.round((current - starting) * 10) / 10;
    const target = client?.target_weight ? Number(client.target_weight) : null;

    return {
      starting,
      current,
      delta,
      target,
      totalEntries: allSorted.length,
    };
  }, [metrics, client]);

  if (!stats || chartData.length === 0) {
    return (
      <div className="surface-card p-6 rounded-xl border border-border/80 text-center">
        <div className="w-12 h-12 rounded-xl bg-secondary/50 border border-border/60 flex items-center justify-center mx-auto mb-3 text-muted-foreground">
          <Scale className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">No Weight Entries Yet</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Your progress graph will appear here once your coach logs your first biometric check-in.
        </p>
      </div>
    );
  }

  // Determine min & max for Y-Axis padding
  const weights = chartData.map((d) => d.weight);
  const minWeight = Math.floor(Math.min(...weights) - 1);
  const maxWeight = Math.ceil(Math.max(...weights) + 1);

  return (
    <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80 glow-subtle">
      {/* Header & period toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-primary" />
            Your Weight Progress
          </span>
          <div className="flex items-baseline gap-2.5 mt-1">
            <span className="text-2xl lg:text-3xl font-bold font-display tracking-tight text-foreground tabular-nums">
              {stats.current} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </span>
            {stats.delta !== 0 && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full border',
                  stats.delta < 0
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                )}
              >
                {stats.delta < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                {stats.delta > 0 ? `+${stats.delta}` : stats.delta} kg
              </span>
            )}
          </div>
        </div>

        {/* Period filter buttons */}
        <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50 self-start sm:self-auto">
          {['7D', '1M', '3M', 'ALL'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                period === p
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 mb-5 border-y border-border/40 text-center">
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Starting</span>
          <span className="text-sm font-bold text-foreground font-mono">{stats.starting} kg</span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Current</span>
          <span className="text-sm font-bold text-primary font-mono">{stats.current} kg</span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Total Change</span>
          <span className={cn('text-sm font-bold font-mono', stats.delta <= 0 ? 'text-emerald-400' : 'text-amber-400')}>
            {stats.delta > 0 ? `+${stats.delta}` : stats.delta} kg
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Target</span>
          <span className="text-sm font-bold text-foreground font-mono">
            {stats.target ? `${stats.target} kg` : '—'}
          </span>
        </div>
      </div>

      {/* Chart container */}
      <div className="h-56 sm:h-64 w-full">
        {chartData.length === 1 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-border/50 rounded-lg">
            <Calendar className="w-6 h-6 text-muted-foreground mb-2" />
            <p className="text-xs text-foreground font-medium">1 measurement logged ({chartData[0].weight} kg)</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              The line progression will emerge as future measurements are recorded.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="weightLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d)}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[minWeight, maxWeight]}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                        <p className="font-semibold text-foreground">{formatDate(data.date)}</p>
                        <p className="text-primary font-bold mt-0.5">{data.weight} kg</p>
                        {data.body_fat != null && (
                          <p className="text-muted-foreground text-[11px] mt-0.5">{data.body_fat}% Body Fat</p>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="url(#weightLineGrad)"
                strokeWidth={2.5}
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 3.5, stroke: 'hsl(var(--background))' }}
                activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
