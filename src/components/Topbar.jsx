import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Search, Bell, LogOut, ChevronDown, User as UserIcon, Repeat, Building2, Check } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { WorkspacesService } from '@/services/workspaces';
import { getActiveWorkspaceId, getRoleCategory } from '@/lib/ybs-auth';
import { getInitials } from '@/lib/ybs-utils';

const dropdownVariants = {
  initial: { opacity: 0, scale: 0.96, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.13, ease: 'easeIn' } },
};

export default function Topbar({ onMenuClick }) {
  const { user, logout, switchActiveWorkspace, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState('');
  const [switching, setSwitching] = useState(false);

  const cat = getRoleCategory(user);
  const switchable = cat === 'workspace' || cat === 'coach';
  const activeWsId = getActiveWorkspaceId(user);

  const loadSwitchableWorkspaces = useCallback(async () => {
    if (!switchable) return;
    setWorkspacesLoading(true);
    setWorkspacesError('');
    try {
      const mine = await WorkspacesService.listMemberWorkspaces();
      setWorkspaces((mine || []).map((m) => ({ id: m.workspace_id, name: m.name, is_active: m.is_active })));
    } catch (err) {
      setWorkspacesError(err?.message || 'Failed to load workspaces.');
    } finally {
      setWorkspacesLoading(false);
    }
  }, [switchable]);

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

  const handleAddAccount = () => { setMenuOpen(false); logout('/login'); };

  const handleSwitch = async (wsId) => {
    if (wsId === activeWsId) { setMenuOpen(false); return; }
    setSwitching(true);
    try {
      if (switchActiveWorkspace) await switchActiveWorkspace(wsId);
      else if (refreshProfile) await refreshProfile();
    } catch { /* ignore */ }
    setSwitching(false);
    setMenuOpen(false);
    navigate(cat === 'coach' ? '/coach/dashboard' : `/workspace/${wsId}/dashboard`);
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeWsId);

  return (
    <header className="ybs-topbar sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8 border-b border-border">
      <div className="flex items-center gap-3 flex-1">
        <motion.button
          className="lg:hidden text-muted-foreground hover:text-foreground"
          onClick={onMenuClick}
          aria-label="Open navigation"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.15 }}
        >
          <Menu className="w-5 h-5" />
        </motion.button>

        {/* Global search */}
        <div className="relative max-w-sm w-full hidden sm:block ml-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            aria-label="Search clients, plans, and exercises"
            placeholder="Search clients, plans, exercises…"
            className="w-full h-9 pl-9 pr-4 rounded-xl bg-secondary/50 border border-border text-[14px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/25 transition-all duration-150"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Notification bell */}
        <motion.button
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          onClick={() => navigate('/notifications')}
          aria-label="Notifications"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ duration: 0.15 }}
        >
          <Bell className="w-[18px] h-[18px]" />
        </motion.button>

        <div aria-hidden="true" className="w-px h-6 bg-border mx-1" />

        {/* Account menu */}
        <div className="relative">
          <motion.button
            onClick={openMenu}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-full hover:bg-foreground/[0.06] transition-colors"
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="w-8 h-8 rounded-full bg-secondary/70 border border-border/70 flex items-center justify-center text-foreground text-xs font-semibold"
              whileHover={{ scale: 1.04 }}
              transition={{ duration: 0.2 }}
            >
              {getInitials(user?.full_name || user?.email || 'U')}
            </motion.div>
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-[14px] font-medium text-foreground">{user?.full_name || 'User'}</span>
              <span className="text-[12px] text-muted-foreground mt-0.5">{getDisplayRole()}</span>
            </div>
            <motion.div
              animate={{ rotate: menuOpen ? 180 : 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
            </motion.div>
          </motion.button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <motion.div
                  className="absolute right-0 top-full mt-2 w-64 bg-popover border border-border/80 rounded-xl shadow-xl shadow-black/40 z-50 overflow-hidden"
                  variants={dropdownVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <div className="px-4 py-3 border-b border-border/60">
                    <p className="text-[14px] font-medium text-foreground truncate">{user?.full_name || 'User'}</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
                    {activeWsId && activeWorkspace && (
                      <p className="text-[12px] text-primary font-medium mt-1 truncate flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {activeWorkspace.name}
                      </p>
                    )}
                  </div>

                  <div className="py-1">
                    {[
                      { label: 'Profile', icon: UserIcon, onClick: handleProfile },
                    ].map(({ label, icon: Icon, onClick }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={onClick}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                      >
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    ))}

                    {switchable && (
                      <div className="border-t border-border/60">
                        <p className="px-4 pt-2 pb-1 text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Repeat className="w-3 h-3" /> Switch Workspace
                        </p>
                        <div className="max-h-44 overflow-y-auto px-1">
                          {workspacesLoading ? (
                            <p className="px-3 py-2 text-[12px] text-muted-foreground">Loading workspaces…</p>
                          ) : workspacesError ? (
                            <div className="px-3 py-2">
                              <p className="text-[12px] text-red-400">{workspacesError}</p>
                              <button
                                type="button"
                                onClick={loadSwitchableWorkspaces}
                                className="text-[12px] text-primary hover:underline mt-1"
                              >
                                Retry
                              </button>
                            </div>
                          ) : workspaces.length === 0 ? (
                            <p className="px-3 py-2 text-[12px] text-muted-foreground">No workspaces assigned yet.</p>
                          ) : workspaces.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => handleSwitch(w.id)}
                              disabled={switching}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-foreground/[0.06] transition-colors disabled:opacity-50"
                            >
                              <div className="w-5 h-5 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                                <span className="text-[12px] font-semibold text-primary">{w.name?.[0] || 'W'}</span>
                              </div>
                              <span className="text-[12px] font-medium truncate flex-1">{w.name}</span>
{w.id === activeWsId && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAddAccount}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                    >
                      <Repeat className="w-4 h-4" /> Add Account
                    </button>

                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); logout(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-[14px] text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
