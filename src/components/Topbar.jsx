import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, LogOut, ChevronDown, User as UserIcon, Repeat, Building2, Check } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { WorkspacesService } from '@/services/workspaces';
import { getActiveWorkspaceId, getRoleCategory } from '@/lib/ybs-auth';
import { getInitials } from '@/lib/ybs-utils';

export default function Topbar({ onMenuClick }) {
  const { user, logout, switchActiveWorkspace, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [switching, setSwitching] = useState(false);

  const cat = getRoleCategory(user);
  const switchable = cat === 'workspace' || cat === 'coach';
  const activeWsId = getActiveWorkspaceId(user);

  const loadSwitchableWorkspaces = useCallback(async () => {
    if (!switchable) return;
    try {
      const all = await WorkspacesService.list();
      const mine = all.filter((w) =>
        (user?.workspace_ids || []).includes(w.id) || (user?.managed_workspace_ids || []).includes(w.id)
      );
      setWorkspaces(mine || []);
    } catch { /* ignore workspace load failure */ }
  }, [switchable, user?.workspace_ids, user?.managed_workspace_ids]);

  const openMenu = () => {
    setMenuOpen((v) => !v);
    if (!menuOpen) loadSwitchableWorkspaces();
  };

  const getDisplayRole = () => {
    if (user?.platform_role === 'platform_owner') return 'Platform Owner';
    if (user?.platform_role === 'platform_trainer') return 'YBS Coach';
    if (user?.managed_workspace_ids?.length > 0) return 'Workspace Owner';
    if (user?.self_client_id) return 'Client';
    return 'User';
  };

  const handleProfile = () => {
    setMenuOpen(false);
    if (user?.self_client_id) navigate('/portal/profile');
    else if (cat === 'admin' || cat === 'workspace') navigate('/settings');
    else navigate('/coach/dashboard');
  };

  const handleAddAccount = () => {
    setMenuOpen(false);
    logout('/login');
  };

  const handleSwitch = async (wsId) => {
    if (wsId === activeWsId) {
      setMenuOpen(false);
      return;
    }
    setSwitching(true);
    try {
      if (switchActiveWorkspace) {
        await switchActiveWorkspace(wsId);
      } else if (refreshProfile) {
        await refreshProfile();
      }
    } catch { /* surface nothing; keep current workspace */ }
    setSwitching(false);
    setMenuOpen(false);
    navigate(cat === 'coach' ? '/coach/dashboard' : `/workspace/${wsId}/dashboard`);
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeWsId);

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 lg:px-6 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="flex items-center gap-3 flex-1">
        <button
          className="lg:hidden text-muted-foreground hover:text-foreground"
          onClick={onMenuClick}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Global search */}
        <div className="relative max-w-md w-full hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search clients, plans, exercises…"
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary/60 border border-border text-[13px] placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          onClick={() => navigate('/notifications')}
        >
          <Bell className="w-[18px] h-[18px]" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
        </button>

        {/* Account menu */}
        <div className="relative">
          <button
            onClick={openMenu}
            className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-secondary/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-primary text-xs font-semibold">
              {getInitials(user?.full_name || user?.email || 'U')}
            </div>
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-[13px] font-medium text-foreground">{user?.full_name || 'User'}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{getDisplayRole()}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-64 bg-popover border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[13px] font-medium text-foreground truncate">{user?.full_name || 'User'}</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
                  {activeWsId && activeWorkspace && (
                    <p className="text-[10px] text-primary font-medium mt-1 truncate flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> {activeWorkspace.name}
                    </p>
                  )}
                </div>

                <div className="py-1">
                  <button
                    onClick={handleProfile}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <UserIcon className="w-4 h-4" /> Profile
                  </button>

                  {switchable && (
                    <div className="border-t border-border/60">
                      <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Repeat className="w-3 h-3" /> Switch Workspace
                      </p>
                      <div className="max-h-44 overflow-y-auto px-1">
                        {workspaces.length === 0 && (
                          <p className="px-3 py-2 text-[11px] text-muted-foreground">Loading workspaces…</p>
                        )}
                        {workspaces.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => handleSwitch(w.id)}
                            disabled={switching}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-secondary/60 transition-colors disabled:opacity-50"
                          >
                            <div className="w-5 h-5 rounded bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-semibold text-primary">{w.name?.[0] || 'W'}</span>
                            </div>
                            <span className="text-[12px] font-medium truncate flex-1">{w.name}</span>
                            {w.id === activeWsId && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleAddAccount}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <Repeat className="w-4 h-4" /> Add Account
                  </button>

                  <button
                    onClick={() => { setMenuOpen(false); logout(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}