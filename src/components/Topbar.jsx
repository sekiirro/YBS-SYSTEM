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
    } catch { /* ignore */ }
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
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 lg:px-6 glass-strong border-b border-white/[0.08]">
      <div className="flex items-center gap-3 flex-1">
        <motion.button
          className="lg:hidden text-muted-foreground hover:text-foreground"
          onClick={onMenuClick}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.15 }}
        >
          <Menu className="w-5 h-5" />
        </motion.button>

        {/* Global search */}
        <div className="relative max-w-sm w-full hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search clients, plans, exercises…"
            className="w-full h-9 pl-9 pr-4 rounded-full bg-white/5 border border-white/10 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:bg-white/[0.07] focus:ring-1 focus:ring-primary/20 transition-all duration-200"
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Notification bell */}
        <motion.button
          className="relative p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          onClick={() => navigate('/notifications')}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.15 }}
        >
          <Bell className="w-[18px] h-[18px]" />
          <motion.span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ boxShadow: ['0 0 0px hsl(217 91% 60% / 0.6)', '0 0 8px hsl(217 91% 60% / 0.8)', '0 0 0px hsl(217 91% 60% / 0.6)'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.button>

        {/* Account menu */}
        <div className="relative">
          <motion.button
            onClick={openMenu}
            className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-full hover:bg-white/5 transition-colors"
            whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-cyan-400/20 border border-primary/25 flex items-center justify-center text-primary text-xs font-semibold"
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
            >
              {getInitials(user?.full_name || user?.email || 'U')}
            </motion.div>
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-[13px] font-medium text-foreground">{user?.full_name || 'User'}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{getDisplayRole()}</span>
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
                  className="absolute right-0 top-full mt-2 w-64 bg-popover border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden"
                  variants={dropdownVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <div className="px-4 py-3 border-b border-white/[0.08]">
                    <p className="text-[13px] font-medium text-foreground truncate">{user?.full_name || 'User'}</p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
                    {activeWsId && activeWorkspace && (
                      <p className="text-[10px] text-primary font-medium mt-1 truncate flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {activeWorkspace.name}
                      </p>
                    )}
                  </div>

                  <div className="py-1">
                    {[
                      { label: 'Profile', icon: UserIcon, onClick: handleProfile },
                    ].map(({ label, icon: Icon, onClick }) => (
                      <motion.button
                        key={label}
                        onClick={onClick}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        whileHover={{ x: 2 }}
                        transition={{ duration: 0.12 }}
                      >
                        <Icon className="w-4 h-4" /> {label}
                      </motion.button>
                    ))}

                    {switchable && (
                      <div className="border-t border-white/[0.08]">
                        <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Repeat className="w-3 h-3" /> Switch Workspace
                        </p>
                        <div className="max-h-44 overflow-y-auto px-1">
                          {workspaces.length === 0 && (
                            <p className="px-3 py-2 text-[11px] text-muted-foreground">Loading workspaces…</p>
                          )}
                          {workspaces.map((w) => (
                            <motion.button
                              key={w.id}
                              onClick={() => handleSwitch(w.id)}
                              disabled={switching}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/5 transition-colors disabled:opacity-50"
                              whileHover={{ x: 2 }}
                              transition={{ duration: 0.12 }}
                            >
                              <div className="w-5 h-5 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-semibold text-primary">{w.name?.[0] || 'W'}</span>
                              </div>
                              <span className="text-[12px] font-medium truncate flex-1">{w.name}</span>
                              {w.id === activeWsId && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}

                    <motion.button
                      onClick={handleAddAccount}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                      whileHover={{ x: 2 }}
                      transition={{ duration: 0.12 }}
                    >
                      <Repeat className="w-4 h-4" /> Add Account
                    </motion.button>

                    <motion.button
                      onClick={() => { setMenuOpen(false); logout(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
                      whileHover={{ x: 2 }}
                      transition={{ duration: 0.12 }}
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </motion.button>
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