import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { AssessmentsService } from '@/services/assessments';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button } from '@/components/ui';
import { formatDate, getFormStatusColor } from '@/lib/ybs-utils';
import { ClipboardList, Search, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Assessments() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const isTrainer = user?.role === 'trainer';

  useEffect(() => { loadForms(); }, []);

  const loadForms = async () => {
    try {
      setLoading(true);
      const filter = isTrainer ? { assigned_ybs_coach_id: user.id } : {};
      const data = await AssessmentsService.list(filter);
      setForms(data);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return forms.filter((f) => {
      if (search) {
        const q = search.toLowerCase();
        if (!f.name?.toLowerCase().includes(q) && !f.assigned_client_name?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && f.submission_status !== statusFilter) return false;
      return true;
    });
  }, [forms, search, statusFilter]);

  if (loading) return <LoadingState label="Loading assessments…" />;

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Form assignments and submissions"
        icon={ClipboardList}
        actions={hasPermission(user, 'forms.create') && <Button><Plus className="w-4 h-4" /> New Form</Button>}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search forms…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assessments found" description="Create and assign forms to clients" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Form</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Due Date</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Submitted</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground">{f.questions?.length || 0} questions</p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{f.assigned_client_name || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(f.due_date)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(f.submitted_date)}</td>
                    <td className="px-4 py-3">
                      <Badge className={cn(getFormStatusColor(f.submission_status), 'capitalize')}>{f.submission_status}</Badge>
                    </td>
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