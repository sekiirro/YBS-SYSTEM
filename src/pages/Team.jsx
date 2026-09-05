import React, { useState, useEffect } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { TeamService } from '@/services/team';
import { ClientsService } from '@/services/clients';
import { canManageTeam } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input, Select } from '@/components/ui';
import { getInitials } from '@/lib/ybs-utils';
import { UsersRound, Plus, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Team() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [showInvite, setShowInvite] = useState(false);

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

  const roleLabel = { owner: 'Owner', manager: 'Head Coach', trainer: 'Trainer' };

  if (loading) return <LoadingState label="Loading team…" />;

  return (
    <div>
      <PageHeader
        title="Team"
        description="Manage team members and permissions"
        icon={UsersRound}
        actions={canManageTeam(user) && <Button onClick={() => setShowInvite(true)}><Plus className="w-4 h-4" /> Invite Member</Button>}
      />
      {users.length === 0 ? (
        <EmptyState icon={UsersRound} title="No team members" description="Invite trainers and coaches to your team" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Member</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Clients</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-[11px] font-semibold">
                          {getInitials(u.full_name || u.email)}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">{u.full_name || 'Unnamed'}</p>
                          <p className="text-[11px] text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn(
                        u.role === 'owner' ? 'text-primary bg-primary/10 border-primary/20' :
                        u.role === 'manager' ? 'text-sky-400 bg-sky-500/10 border-sky-500/20' :
                        'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      )}>{roleLabel[u.role] || u.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{u.phone || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{u.role === 'trainer' ? getClientCount(u.id) : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge className={u.status === 'disabled' ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}>
                        {u.status === 'disabled' ? 'Disabled' : 'Active'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {showInvite && <InviteModal workspaceId={user?.active_workspace_id} onClose={() => setShowInvite(false)} />}
    </div>
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
      const { data } = await supabase.functions.invoke('generate-trainer-invite', {
        body: { email: email.trim(), role: inviteRole, workspace_id: workspaceId },
      });
      if (!data) throw new Error('No response from the invitation service');
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
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400">{error}</div>}
        {result ? (
          result.status === 'already_active' ? (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">{result.message}</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">
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