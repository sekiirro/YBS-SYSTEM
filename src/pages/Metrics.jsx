import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { supabase } from '@/utils/supabase';
import { PageHeader, LoadingState, EmptyState } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { fmtNum, CIRCUMFERENCE_FIELDS, VALIDATION_RANGES } from '@/lib/body-progress';
import { TrendingUp, Search, ChevronRight } from 'lucide-react';

const COLUMNS = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'body_fat', label: 'Body Fat', unit: '%' },
  { key: 'height', label: 'Height', unit: 'cm' },
  ...CIRCUMFERENCE_FIELDS.map((k) => ({
    key: k,
    label: VALIDATION_RANGES[k]?.label || k,
    unit: VALIDATION_RANGES[k]?.unit || 'cm',
  })),
];

function MetricCell({ row, col }) {
  const value = row && row[col.key] != null && row[col.key] !== '' ? fmtNum(row[col.key]) : null;
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {value} <span className="text-muted-foreground font-normal">{col.unit}</span>
    </span>
  );
}

export default function Metrics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { loadMetrics(); }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const [{ data, error }, countResult] = await Promise.all([
        supabase
          .from('metrics')
          .select('*, clients(full_name, client_code)')
          .order('entry_date', { ascending: false })
          .limit(200),
        supabase.from('metrics').select('id', { count: 'exact', head: true }),
      ]);
      if (error) throw error;
      const formatted = (data || []).map((m) => ({
        ...m,
        client_name: m.clients?.full_name || m.client_name || 'Client',
        client_code: m.clients?.client_code || '',
      }));
      setMetrics(formatted);
      setStats({ total: countResult?.count ?? null });
    } catch (err) {
      console.error('Error loading metrics:', err);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return metrics.filter((m) => !search || m.client_name?.toLowerCase().includes(search.toLowerCase()));
  }, [metrics, search]);

  if (loading) return <LoadingState label="Loading metrics…" />;

  return (
    <div>
      <PageHeader title="Metrics" description="Progress tracking and measurements" icon={TrendingUp} />
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search by client…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[14px] focus:outline-none focus:border-primary/40" />
        </div>
        {stats?.total != null && (
          <span className="text-[12px] text-muted-foreground">
            {metrics.length < stats.total ? `${metrics.length} of ` : ''}{stats.total} total entries
          </span>
        )}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No metrics recorded" description="Add progress entries from client profiles" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="text-right px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                  <th className="w-8 px-2" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m.id}
                    className="group border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/clients/${m.client_id}?tab=metrics`)}
                    title={`Open ${m.client_name}'s progress`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[12px] font-semibold text-primary shrink-0">
                          {(m.client_name || '?').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium truncate">{m.client_name}</p>
                          {m.client_code && <p className="text-[12px] text-muted-foreground font-mono truncate">{m.client_code}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{formatDate(m.entry_date)}</td>
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-[12px] text-right tabular-nums whitespace-nowrap">
                        <MetricCell row={m} col={col} />
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right">
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats?.total != null && stats.total > 200 && (
            <div className="px-4 py-3 border-t border-border/50 text-[12px] text-muted-foreground">
              Showing the 200 most recent entries. The full history is available from each client's profile.
            </div>
          )}
        </div>
      )}
    </div>
  );
}