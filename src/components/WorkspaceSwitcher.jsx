import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import { WorkspacesService } from '@/services/workspaces';
import { getRoleCategory, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { cn } from '@/lib/utils';
import { ChevronDown, Check, Building2 } from 'lucide-react';

// Workspace switcher — lists only workspaces the user is authorized to access.
// Switching sets the active workspace context (persisted on the user) and navigates.
export default function WorkspaceSwitcher({ collapsed }) {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  const cat = getRoleCategory(user);
  // Platform admins see all workspaces; workspace/coach users see their memberships.
  const showSwitcher = cat === 'workspace' || cat === 'coach' || cat === 'admin';
  const wsIds = cat === 'admin'
    ? []
    : Array.from(new Set([...(user?.managed_workspace_ids || []), ...(user?.workspace_ids || [])]));

  useEffect(() => {
    if (!showSwitcher || cat === 'admin') { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const all = await WorkspacesService.list();
        const mine = all.filter((w) => wsIds.includes(w.id));
        if (alive) { setWorkspaces(mine); setLoading(false); }
      } catch { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [showSwitcher]);

  if (!showSwitcher) return null;

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

  if (loading || workspaces.length === 0) return null;

  // Single workspace owner — display workspace name without switcher dropdown
  if (workspaces.length === 1) {
    return (
      <div className={cn('px-2', collapsed && 'px-0')}>
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 border border-border', collapsed && 'justify-center')}>
          <div className="w-5 h-5 rounded bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-semibold text-primary">{active?.name?.[0] || 'W'}</span>
          </div>
          {!collapsed && <span className="text-[12px] font-medium truncate flex-1">{active?.name || 'Workspace'}</span>}
        </div>
      </div>
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