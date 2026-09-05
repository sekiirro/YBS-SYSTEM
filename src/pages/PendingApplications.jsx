import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';
import { PageHeader, LoadingState, Badge, Button, Modal, TextArea, Select } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { ClipboardCheck, Check, X, MessageSquare, Eye, Loader2, Filter, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_STYLE = {
  pending: 'text-warning bg-warning/10 border-warning/20',
  under_review: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  more_info_required: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  approved: 'text-success bg-success/10 border-success/20',
  rejected: 'text-destructive bg-destructive/10 border-destructive/20',
};

export default function PendingApplications() {
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [packagesByWs, setPackagesByWs] = useState({});
  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState(null); // approve | reject | moreinfo
  const [reason, setReason] = useState('');
  const [moreInfo, setMoreInfo] = useState('');
  const [wsChoice, setWsChoice] = useState('');
  const [trainerChoice, setTrainerChoice] = useState('');
  const [packageChoice, setPackageChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [appsRes, wsRes, trainersRes, pkgRes] = await Promise.all([
        supabase
          .from('client_applications')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('workspaces')
          .select('id, name, status')
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('profiles')
          .select('id, full_name, email, phone')
          .eq('platform_role', 'platform_trainer')
          .eq('account_status', 'active')
          .order('full_name'),
        supabase
          .from('packages')
          .select('id, name, tier, duration, duration_unit, workspace_id, is_active')
          .eq('is_active', true)
          .order('price'),
      ]);

      if (appsRes.data) setApps(appsRes.data);
      if (wsRes.data) setWorkspaces(wsRes.data);
      if (trainersRes.data) setTrainers(trainersRes.data);

      if (pkgRes.data) {
        const map = {};
        (pkgRes.data || []).forEach((p) => {
          const wsId = p.workspace_id || 'global';
          if (!map[wsId]) map[wsId] = [];
          map[wsId].push(p);
        });
        setPackagesByWs(map);
      }
    } catch (e) {
      console.error('Error loading pending applications:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = apps.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !a.applicant_name?.toLowerCase().includes(q) &&
        !a.applicant_phone?.toLowerCase().includes(q) &&
        !a.applicant_email?.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const openAction = (a, act) => {
    setSelected(a);
    setAction(act);
    setErr('');
    setReason('');
    setMoreInfo('');
    setWsChoice(a.assigned_workspace_id || '');
    setTrainerChoice(a.assigned_ybs_trainer_id || '');
    setPackageChoice(a.assigned_package_id || '');
  };

  const runAction = async () => {
    setErr('');
    if (action === 'approve' && !selected.assigned_workspace_id && !wsChoice) {
      setErr('Please select a workspace for the client');
      return;
    }
    setBusy(true);

    try {
      if (action === 'approve') {
        // When the trainee registered through a package registration
        // link, workspace/coach/package are established on the
        // application server-side. Pass NULLs so the RPC resolves them
        // from the application context; only an explicit admin choice
        // overrides.
        const { data, error } = await supabase.rpc('approve_client_application', {
          p_application_id: selected.id,
          p_workspace_id: selected.assigned_workspace_id ? null : wsChoice,
          p_trainer_id: trainerChoice || null,
          p_package_id: packageChoice || null,
        });
        if (error) throw error;
      } else if (action === 'reject') {
        const { data, error } = await supabase.rpc('reject_client_application', {
          p_application_id: selected.id,
          p_reason: reason || null,
        });
        if (error) throw error;
      } else if (action === 'moreinfo') {
        const { error } = await supabase
          .from('client_applications')
          .update({
            more_info_request: moreInfo,
            status: 'more_info_required',
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', selected.id);
        if (error) throw error;
      }

      setAction(null);
      setConfirmOpen(false);
      setSelected(null);
      load();
    } catch (e) {
      setErr(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading client applications…" />;

  const pendingCount = apps.filter((a) => a.status === 'pending' || a.status === 'under_review').length;
  const workspaceName = (id) => (id ? workspaces.find((w) => w.id === id)?.name || '—' : '—');
  const packageName = (id) => {
    if (!id) return '—';
    for (const list of Object.values(packagesByWs)) {
      const found = list.find((p) => p.id === id);
      if (found) return found.name;
    }
    return '—';
  };

  return (
    <div>
      <PageHeader
        title="Pending Client Approvals"
        description={`${pendingCount} applications awaiting review`}
        icon={ClipboardCheck}
      />

      {/* Filters */}
      <div className="surface-card p-4 mb-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            >
              <option value="pending">Pending</option>
              <option value="under_review">Under Review</option>
              <option value="more_info_required">More Info Required</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="surface-card p-10 text-center text-muted-foreground text-[13px]">
          No applications match this filter.
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Applicant', 'Workspace / Brand', 'Package', 'Phone', 'Submitted', 'Status', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium">{a.applicant_name}</p>
                      <p className="text-[11px] text-muted-foreground">{a.applicant_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[12px] font-medium">{workspaceName(a.assigned_workspace_id)}</p>
                      {a.assigned_workspace_id && (
                        <p className="text-[11px] text-muted-foreground">via registration link</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] text-muted-foreground">{packageName(a.assigned_package_id)}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground font-mono">{a.applicant_phone}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {formatDate(a.submitted_at || a.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn(STATUS_STYLE[a.status] || STATUS_STYLE.pending, 'capitalize')}>
                        {a.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelected(a);
                            setAction(null);
                          }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {a.status !== 'approved' && a.status !== 'rejected' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-success hover:text-success"
                              onClick={() => openAction(a, 'approve')}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => openAction(a, 'reject')}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openAction(a, 'moreinfo')}>
                              <MessageSquare className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lg:hidden divide-y divide-border">
            {filtered.map((a) => (
              <div key={a.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-medium">{a.applicant_name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{a.applicant_phone}</p>
                  </div>
                  <Badge className={cn(STATUS_STYLE[a.status] || STATUS_STYLE.pending, 'capitalize')}>
                    {a.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="mt-1.5">
                  <p className="text-[12px] text-muted-foreground">
                    <strong className="text-foreground font-medium">{workspaceName(a.assigned_workspace_id)}</strong>
                    {a.assigned_workspace_id ? ' — via registration link' : ''}
                  </p>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setSelected(a);
                      setAction(null);
                    }}
                  >
                    View
                  </Button>
                  {a.status !== 'approved' && a.status !== 'rejected' && (
                    <>
                      <Button size="sm" className="text-success" onClick={() => openAction(a, 'approve')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => openAction(a, 'reject')}>
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail / Action modal */}
      {selected && (
        <Modal
          open
          onClose={() => {
            setSelected(null);
            setAction(null);
            setErr('');
            setConfirmOpen(false);
          }}
          title={action ? actionLabel(action) : 'Client Application Details'}
          size="lg"
        >
          {err && (
            <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">
              {err}
            </div>
          )}
          <div className="space-y-3">
            <DetailRow label="Applicant" value={selected.applicant_name} />
            <DetailRow label="Email" value={selected.applicant_email} />
            <DetailRow label="Phone" value={selected.applicant_phone} />
            <DetailRow
              label="Workspace / Brand"
              value={
                <>
                  {workspaceName(selected.assigned_workspace_id)}
                  {selected.assigned_workspace_id && (
                    <span className="text-[11px] text-muted-foreground ml-1">(via registration link)</span>
                  )}
                </>
              }
            />
            <DetailRow
              label="Package"
              value={packageName(selected.assigned_package_id) || 'No package (will be unassigned)'}
            />
            <DetailRow label="Registered Date" value={formatDate(selected.submitted_at || selected.created_at)} />
            <DetailRow
              label="Status"
              value={
                <Badge className={cn(STATUS_STYLE[selected.status] || STATUS_STYLE.pending, 'capitalize')}>
                  {selected.status.replace(/_/g, ' ')}
                </Badge>
              }
            />
            {selected.more_info_request && <DetailRow label="Information Requested" value={selected.more_info_request} />}
            {selected.more_info_response && <DetailRow label="Client Response" value={selected.more_info_response} />}
            {selected.rejection_reason && <DetailRow label="Rejection Reason" value={selected.rejection_reason} />}

            {action === 'approve' && (
              <div className="pt-2 border-t border-border space-y-3">
                {selected.assigned_workspace_id ? (
                  <div className="p-3 rounded-md bg-primary/5 border border-primary/15">
                    <p className="text-[12px] font-medium text-foreground">
                      <Check className="w-3.5 h-3.5 inline mr-1 text-success" />
                      Workspace confirmed via registration link
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      This trainee registered through <strong className="text-foreground">{workspaceName(selected.assigned_workspace_id)}</strong>'s
                      public link. Approval will assign them to this workspace automatically — no selection needed.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Select Target Brand Workspace *
                    </p>
                    <Select label="Workspace *" value={wsChoice} onChange={(e) => setWsChoice(e.target.value)}>
                      <option value="">Select workspace…</option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
                <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider pt-1">
                  Assign YBS Coach (Optional)
                </p>
                <Select
                  label="YBS Coach"
                  value={trainerChoice}
                  onChange={(e) => setTrainerChoice(e.target.value)}
                >
                  <option value="">No internal coach assigned yet</option>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name || t.email} ({t.phone || 'No phone'})
                    </option>
                  ))}
                </Select>

                <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider pt-2">
                  Package
                </p>
                {selected.assigned_package_id ? (
                  <div className="p-3 rounded-md bg-primary/5 border border-primary/15">
                    <p className="text-[12px] font-medium text-foreground">
                      <Check className="w-3.5 h-3.5 inline mr-1 text-success" />
                      Package confirmed via registration link
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      {packageName(selected.assigned_package_id)} was selected on the registration link. You may change
                      it below if needed.
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground mb-1">
                    No package was selected on the registration link. Choose one to assign a subscription.
                  </p>
                )}
                <Select
                  label="Package"
                  value={packageChoice}
                  onChange={(e) => setPackageChoice(e.target.value)}
                >
                  <option value="">
                    {selected.assigned_package_id
                      ? `Keep ${packageName(selected.assigned_package_id)}`
                      : 'No package assigned'}
                  </option>
                  {((selected.assigned_workspace_id || wsChoice) && (packagesByWs[selected.assigned_workspace_id || wsChoice] || []).length)
                    ? (packagesByWs[selected.assigned_workspace_id || wsChoice] || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.tier} · {p.duration} {p.duration_unit})
                        </option>
                      ))
                    : (packagesByWs['global'] || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.tier} · {p.duration} {p.duration_unit})
                        </option>
                      ))}
                </Select>
              </div>
            )}

            {action === 'reject' && (
              <TextArea
                label="Rejection reason (optional)"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason shared with the client…"
              />
            )}

            {action === 'moreinfo' && (
              <TextArea
                label="Information requested *"
                rows={3}
                value={moreInfo}
                onChange={(e) => setMoreInfo(e.target.value)}
                placeholder="What additional information or health documentation do you need?"
              />
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setAction(null);
                  setErr('');
                  setConfirmOpen(false);
                }}
              >
                Cancel
              </Button>
              {action && (
                <Button onClick={() => setConfirmOpen(true)} disabled={action === 'moreinfo' && !moreInfo.trim()}>
                  {actionLabel(action)}
                </Button>
              )}
              {!action && selected.status !== 'approved' && selected.status !== 'rejected' && (
                <>
                  <Button variant="destructive" onClick={() => openAction(selected, 'reject')}>
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                  <Button variant="secondary" onClick={() => openAction(selected, 'moreinfo')}>
                    <MessageSquare className="w-4 h-4 mr-1" />
                    Request Info
                  </Button>
                  <Button onClick={() => openAction(selected, 'approve')}>
                    <Check className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Confirmation dialog */}
          {confirmOpen && (
            <div className="absolute inset-0 bg-background/95 flex items-center justify-center p-6 rounded-2xl">
              <div className="text-center max-w-sm">
                <p className="text-[15px] font-display font-semibold mb-2">Confirm {actionLabel(action)}</p>
                <p className="text-[13px] text-muted-foreground mb-5">
                  {action === 'approve'
                    ? `Assign ${selected.applicant_name} to "${
                        selected.assigned_workspace_id
                          ? workspaceName(selected.assigned_workspace_id)
                          : workspaces.find((w) => w.id === wsChoice)?.name || 'the selected workspace'
                      }" and activate account?`
                    : `Are you sure you want to ${action === 'reject' ? 'reject' : 'request more info from'} ${
                        selected.applicant_name
                      }?`}
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={runAction} disabled={busy}>
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      'Confirm'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function actionLabel(a) {
  return a === 'approve'
    ? 'Approve Client'
    : a === 'reject'
    ? 'Reject Application'
    : a === 'moreinfo'
    ? 'Request More Info'
    : '';
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-[13px] mt-0.5">{value || '—'}</div>
    </div>
  );
}