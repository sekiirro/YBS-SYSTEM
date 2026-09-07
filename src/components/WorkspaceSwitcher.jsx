import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { WorkspacesService } from '@/services/workspaces';
import { getRoleCategory, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { cn } from '@/lib/utils';
import { ChevronDown, Check, Building2, Loader2, RefreshCcw } from 'lucide-react';

// Workspace switcher — lists only workspaces the user is authorized to access.
// Switching sets the active workspace context (persisted on the user) and navigates.
export default function WorkspaceSwitcher({ collapsed }) {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cat = getRoleCategory(user);
  // Platform admins see all workspaces; workspace/coach users see their memberships.
  const showSwitcher = cat === 'workspace' || cat === 'coach' || cat === 'admin';

  const load = useCallback(async () => {
    if (!showSwitcher || cat === 'admin') { setLoading(false); return; }
    try {
      setError('');
      const mine = await WorkspacesService.listMemberWorkspaces();
      setWorkspaces((mine || []).map((m) => ({ id: m.workspace_id, name: m.name, is_active: m.is_active })));
    } catch (e) {
      setError(e?.message || 'Failed to load workspaces.');
    } finally {
      setLoading(false);
    }
  }, [showSwitcher, cat]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (!showSwitcher) return null;

  if (cat === 'admin') {
    return (
      <div className={cn('px-2', collapsed && 'px-0')}>
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 border border-border', collapsed && 'justify-center')}>
          <Building2 className="w-4 h-4 text-primary shrink-0" />
          {!collapsed && <span className="text-[12px] font-medium">Platform View</span>}
        </div>
      </div>
    );
  }

  const activeId = getActiveWorkspaceId(user);
  const active = workspaces.find((w) => w.id === activeId) || workspaces[0];

  const handleSelect = async (wsId) => {
    setOpen(false);
    if (wsId === activeId) return;
    try {
      if (user?.id) {
        await supabase.from('profiles').update({ active_workspace_id: wsId }).eq('id', user.id);
        if (refreshProfile) await refreshProfile();
      }
    } catch (e) { /* ignore */ }
    const cat2 = getRoleCategory(user);
    if (cat2 === 'coach') navigate(`/coach/dashboard`);
    else navigate(`/workspace/${wsId}/dashboard`);
  };

  const pill = (content) => (
    <div className={cn('px-2', collapsed && 'px-0')}>
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 border border-border', collapsed && 'justify-center')}>
        {content}
      </div>
    </div>
  );

  if (loading) {
    return pill(
      <>
        <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
        {!collapsed && <span className="text-[11px] text-muted-foreground">Loading workspaces…</span>}
      </>
    );
  }

  if (error) {
    return pill(
      <>
        <span className="text-[11px] text-destructive truncate flex-1">{error}</span>
        <button type="button" onClick={load} title="Retry" className="text-muted-foreground hover:text-primary shrink-0">
          <RefreshCcw className="w-3.5 h-3.5" />
        </button>
      </>
    );
  }

  if (workspaces.length === 0) {
    return pill(
      <>
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        {!collapsed && <span className="text-[11px] text-muted-foreground">No workspaces assigned yet.</span>}
      </>
    );
  }

  // Single workspace owner — display workspace name without switcher dropdown
  if (workspaces.length === 1) {
    return pill(
      <>
        <div className="w-5 h-5 rounded bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-semibold text-primary">{active?.name?.[0] || 'W'}</span>
        </div>
        {!collapsed && <span className="text-[12px] font-medium truncate flex-1">{active?.name || 'Workspace'}</span>}
      </>
    );
  }

  return (
    <div className="relative px-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 border border-border hover:border-primary/40 transition-colors', collapsed && 'justify-center')}
      >
        <div className="w-5 h-5 rounded bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-semibold text-primary">{active?.name?.[0] || 'W'}</span>
        </div>
        {!collapsed && (
          <>
            <span className="text-[12px] font-medium truncate flex-1 text-left">{active?.name || 'Workspace'}</span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="absolute z-50 mt-1 w-[220px] left-2 right-2 rounded-md bg-popover border border-border shadow-xl overflow-hidden">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">Switch Workspace</p>
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => handleSelect(w.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/60 transition-colors text-left"
            >
              <div className="w-5 h-5 rounded bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-primary">{w.name?.[0]}</span>
              </div>
              <span className="text-[12px] font-medium truncate flex-1">{w.name}</span>
              <span className="text-[10px] text-muted-foreground">{w.client_count || 0}</span>
              {w.id === activeId && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}