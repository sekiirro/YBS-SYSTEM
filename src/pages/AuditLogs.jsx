import React, { useState, useEffect } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { AuditService } from '@/services/audit';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/ybs-utils';
import { ScrollText, Search } from 'lucide-react';

export default function AuditLogs() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const data = await AuditService.list();
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  const filtered = logs.filter((l) =>
    !search || l.actor_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.action?.toLowerCase().includes(search.toLowerCase()) ||
    l.entity_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingState label="Loading audit logs…" />;

  return (
    <div>
      <PageHeader title="Audit Logs" description="System activity and change tracking" icon={ScrollText} />
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Search by actor, action, or entity…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-[hsl(var(--card))] border border-white/[0.08] text-[14px] placeholder:text-muted-foreground hover:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/50 transition-colors" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit logs" description="System actions will be tracked here" />
      ) : (
        <div className="surface-card divide-y divide-white/[0.06] border border-white/[0.08]">
          {filtered.map((log) => (
            <div key={log.id} className="flex items-start gap-3 p-4 hover:bg-white/[0.02] transition-colors">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <ScrollText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-foreground">
                  <span className="font-semibold">{log.actor_name || 'System'}</span>
                  <span className="text-muted-foreground"> {log.action}</span>
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  <span className="capitalize">{log.entity_type}</span> {log.entity_name && `· ${log.entity_name}`}
                </p>
                <p className="text-[12px] text-muted-foreground mt-1.5 font-mono">{formatDateTime(log.created_date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
