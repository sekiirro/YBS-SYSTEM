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
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit logs" description="System actions will be tracked here" />
      ) : (
        <div className="surface-card divide-y divide-border">
          {filtered.map((log) => (
            <div key={log.id} className="flex items-start gap-3 p-4">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <ScrollText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px]">
                  <span className="font-medium">{log.actor_name || 'System'}</span>
                  <span className="text-muted-foreground"> · {log.action}</span>
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {log.entity_type} {log.entity_name && `· ${log.entity_name}`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">{formatDateTime(log.created_date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}