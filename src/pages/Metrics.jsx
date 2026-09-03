import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Button } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { TrendingUp, Search, Plus } from 'lucide-react';

export default function Metrics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState([]);
  const [search, setSearch] = useState('');
  const isTrainer = user?.role === 'trainer';

  useEffect(() => { loadMetrics(); }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('metrics')
        .select('*, clients(full_name, client_code)')
        .order('entry_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      const formatted = (data || []).map((m) => ({
        ...m,
        client_name: m.client_name || m.clients?.full_name || 'Client',
      }));
      setMetrics(formatted);
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
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Search by client…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No metrics recorded" description="Add progress entries from client profiles" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Weight</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Body Fat</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Chest</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Waist</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium">{m.client_name}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(m.entry_date)}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{m.weight ? `${m.weight} kg` : '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{m.body_fat ? `${m.body_fat}%` : '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{m.chest ? `${m.chest}` : '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{m.waist ? `${m.waist}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}