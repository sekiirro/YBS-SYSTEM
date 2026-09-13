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
import { Ruler, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/ybs-utils';
import { toNumber } from '@/lib/body-progress';

const SERIES = [
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

export default function MeasurementsChart({ metrics = [] }) {
  const [series, setSeries] = useState('waist');

  const meta = SERIES.find((s) => s.key === series) || SERIES[0];

  const chartData = useMemo(() => {
    return [...(metrics || [])]
      .map((m) => ({ date: m.entry_date, value: toNumber(m[series]) }))
      .filter((d) => d.value != null)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [metrics, series]);

  return (
    <div className="surface-card p-5 lg:p-6 rounded-xl border border-border/80 glow-subtle">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-primary" />
            Circumference Trends
          </span>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Track how each body measurement changes over time (cm).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/50 max-w-full">
          {SERIES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSeries(s.key)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                series === s.key ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-52 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-border/50 rounded-lg">
            <Calendar className="w-6 h-6 text-muted-foreground mb-2" />
            <p className="text-xs text-foreground font-medium">No {meta.label.toLowerCase()} entries yet</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Add this measurement during a check-in to start the trend.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border px-3 py-2 rounded-lg shadow-xl text-xs">
                      <p className="font-semibold text-foreground">{formatDate(d.date)}</p>
                      <p className="mt-0.5 font-bold" style={{ color: meta.color }}>
                        {d.value} cm — {meta.label}
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
    </div>
  );
}