import ResponsiveTable from '@/components/ui/responsive-table';
import React, { useState, useEffect } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { TeamService } from '@/services/team';
import { ClientsService } from '@/services/clients';
import { canManageTeam } from '@/lib/permissions';
import { getRoleCategory } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input, Select } from '@/components/ui';
import { getInitials, memberDisplayName } from '@/lib/ybs-utils';
import { toast } from '@/components/ui/use-toast';
import { UsersRound, Plus, Copy, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Team() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const isAdminView = getRoleCategory(user) === 'admin';

  useEffect(() => { loadTeam(); }, []);

  const loadTeam = async () => {
    try {
      setLoading(true);
      const [userData, clientData] = await Promise.all([
        TeamService.list(user?.active_workspace_id),
        ClientsService.list(),
      ]);
      setUsers(userData);
      setClients(clientData);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  const getClientCount = (trainerId) => clients.filter((c) => c.assigned_trainer_id === trainerId).length;

  const roleLabel = { owner: 'Owner', manager: 'Head Coach', trainer: 'Trainer', sales: 'Sales', workspace_role: 'Workspace Member' };

  const displayRole = (u) => {
    const wr = u.workspace_role;
    if (wr) {
      if (wr === 'workspace_owner') return 'Workspace Owner';
      if (wr === 'trainer') return 'Trainer';
      if (wr === 'sales') return 'Sales';
      return wr;
    }
    return u.role ? (roleLabel[u.role] || u.role) : '—';
  };

  const roleColor = (u) => {
    const wr = u.workspace_role || u.role;
    if (wr === 'workspace_owner' || wr === 'owner') return 'text-primary bg-primary/10 border-primary/20';
    if (wr === 'manager') return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
    if (wr === 'sales') return 'text-violet-400 bg-violet-500/10 border-violet-500/20';
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  };

  if (loading) return <LoadingState label="Loading team…" />;

  return (
    <div>
      <PageHeader
        title="Team"
        description={isAdminView ? 'Manage team members and permissions' : 'Your workspace\'s staff — trainers, sales, and owners'}
        icon={UsersRound}
        actions={canManageTeam(user) && <Button onClick={() => setShowInvite(true)}><Plus className="w-4 h-4" /> Invite Member</Button>}
      />
      {users.length === 0 ? (
        <EmptyState icon={UsersRound} title="No team members" description="Invite trainers and coaches to your team" />
      ) : (
        <div className="surface-card overflow-hidden border border-white/[0.08]">
          <div className="overflow-x-auto">
            <ResponsiveTable className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06] bg-gradient-to-r from-[hsl(var(--card))] to-transparent">
                  <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Member</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="text-right px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Clients</th>
                  <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] hover:shadow-[inset_2px_0_0_hsl(var(--primary))] transition-all duration-300 group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 shadow-[0_0_10px_hsl(var(--primary)/0.08)] flex items-center justify-center text-primary text-[12px] font-semibold shrink-0">
                          {getInitials(memberDisplayName(u))}
                        </div>
                        <div>
                          <p className="text-[14px] font-medium">{memberDisplayName(u)}</p>
                          {u.email && memberDisplayName(u).toLowerCase() !== u.email.trim().toLowerCase() && (
                            <p className="text-[12px] text-muted-foreground">{u.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn(roleColor(u))}>{displayRole(u)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{u.phone || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{u.role === 'trainer' ? getClientCount(u.id) : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge className={u.status === 'disabled' ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}>
                        {u.status === 'disabled' ? 'Disabled' : 'Active'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManageTeam(user) && (
                        <Button
                          variant="ghost"
                          className="h-8 px-2 text-[12px] text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingMember(u)}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        </div>
      )}
      {showInvite && <InviteModal workspaceId={user?.active_workspace_id} onClose={() => setShowInvite(false)} />}
      {editingMember && (
        <EditMemberModal
          user={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={() => { setEditingMember(null); loadTeam(); }}
        />
      )}
    </div>
  );
}

function EditMemberModal({ user, onClose, onSaved }) {
  const full = (user?.full_name || '').trim();
  const email = (user?.email || '').trim();
  const hasRealName = full && full.toLowerCase() !== email.toLowerCase();

  const [initialFirst, initialLast] = (() => {
    const storedFirst = user?.first_name ? user.first_name : '';
    const storedLast = user?.last_name ? user.last_name : '';
    if (storedFirst || storedLast) return [storedFirst, storedLast];
    if (hasRealName) {
      const parts = full.split(/\s+/);
      return [parts[0], parts.slice(1).join(' ')];
    }
    return ['', ''];
  })();

  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const f = firstName.trim();
    const l = lastName.trim();
    if (!f) {
      setError('Please enter your first name.');
      return;
    }
    if (!l) {
      setError('Please enter your last name.');
      return;
    }
    if (f.length > 80 || l.length > 80) {
      setError('Name is too long.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await TeamService.updateMemberName(user.id, f, l);
      toast('Member name updated.');
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to update member name.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit Member Name">
      <div className="space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[14px] text-red-400">{error}</div>}
        <p className="text-[12px] text-muted-foreground">
          Update the name for <span className="text-foreground font-medium">{email}</span>. Role, email and workspace access are not changed.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ahmed" autoComplete="off" />
          <Input label="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ali" autoComplete="off" />
        </div>
        <div className="p-3 rounded-lg bg-secondary/50 border border-border text-[12px] text-muted-foreground">
          Full name: <span className="text-foreground font-medium">{firstName.trim()} {lastName.trim()}</span>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function InviteModal({ workspaceId, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('trainer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const inviteRole = role === 'owner' ? 'platform_owner' : 'platform_trainer';

  const handleGenerateLink = async () => {
    try {
      setSaving(true);
      setError('');
      setResult(null);
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'generate-trainer-invite',
        {
          body: { email: email.trim(), role: inviteRole, workspace_id: workspaceId },
        }
      );

      if (invokeErr) {
        throw invokeErr;
      }

      if (!data) {
        throw new Error('No response from the invitation service');
      }

      setResult(data);
    } catch (err) {
      setError(err?.context?.error?.message || err?.message || 'Failed to generate invitation link');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!result?.invite_url) return;
    try {
      await navigator.clipboard.writeText(result.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select and copy the link manually.');
    }
  };

  return (
    <Modal open onClose={onClose} title="Invite Team Member">
      <div className="space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[14px] text-red-400">{error}</div>}
        {result ? (
          result.status === 'already_active' ? (
            <div className="space-y-4">
              <p className="text-[14px] text-muted-foreground">{result.message}</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[14px] text-muted-foreground">
                Invitation created for <span className="text-foreground font-medium">{result.email}</span>. No email is sent — share this link directly with the member (WhatsApp, Telegram, SMS). Opening it takes them to set their password with the selected role.
              </p>
              <Input label="Invitation Link" readOnly value={result.invite_url} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose}>Done</Button>
                <Button onClick={copyLink}><Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Link'}</Button>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <Input label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="trainer@example.com" />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="trainer">Trainer</option>
              <option value="manager">Head Coach (Manager)</option>
              <option value="owner">Owner</option>
            </Select>
            <p className="text-[12px] text-muted-foreground">A secure invitation link will be generated. No email is sent — share it directly with the member (WhatsApp, Telegram, SMS).</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleGenerateLink} disabled={saving || !email}>{saving ? 'Generating…' : 'Generate Invitation Link'}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
