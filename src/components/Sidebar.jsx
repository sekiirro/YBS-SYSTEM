import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, Package, ClipboardList, TrendingUp,
  Apple, Dumbbell, Bell, UsersRound, ScrollText, Settings,
  Building2, ClipboardCheck, ChevronLeft, X, Workflow
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { getRoleCategory, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { hasPermission } from '@/lib/permissions';
import WorkspaceSwitcher from './WorkspaceSwitcher';

const SECTIONS = {
  admin: [
    { label: 'Overview', items: [
      { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard, perm: null },
    ]},
    { label: 'Platform', items: [
      { label: 'Workspaces', path: '/admin/workspaces', icon: Building2, perm: 'workspaces.view' },
      { label: 'Pending Approvals', path: '/admin/applications', icon: ClipboardCheck, perm: 'applications.view' },
    ]},
    { label: 'Clients', items: [
      { label: 'Clients', path: '/clients', icon: Users, perm: 'clients.view' },
      { label: 'Forms', path: '/forms', icon: ClipboardList, perm: 'forms.view' },
      { label: 'Form Rules', path: '/forms/rules', icon: Workflow, perm: 'forms.view' },
      { label: 'Metrics', path: '/metrics', icon: TrendingUp, perm: 'metrics.view' },
    ]},
    { label: 'Programs', items: [
      { label: 'Nutrition Plans', path: '/nutrition', icon: Apple, perm: 'nutrition.view' },
      { label: 'Exercise Plans', path: '/workouts', icon: Dumbbell, perm: 'workout.view' },
      { label: 'Food Database', path: '/foods', icon: Apple, perm: null },
      { label: 'Exercises', path: '/exercises', icon: Dumbbell, perm: null },
    ]},
    { label: 'Administration', items: [
      { label: 'Team', path: '/team', icon: UsersRound, perm: 'team.manage' },
      { label: 'Packages', path: '/packages', icon: Package, perm: null },
      { label: 'Notifications', path: '/notifications', icon: Bell, perm: null },
      { label: 'Audit Logs', path: '/audit', icon: ScrollText, perm: 'audit.view' },
      { label: 'Settings', path: '/settings', icon: Settings, perm: 'settings.manage' },
    ]},
  ],
  workspace: [
    { label: 'Overview', items: [
      { label: 'Dashboard', path: '/workspace/__WS__/dashboard', icon: LayoutDashboard, perm: null, ws: true },
    ]},
    { label: 'Clients', items: [
      { label: 'Clients', path: '/clients', icon: Users, perm: 'clients.view' },
      { label: 'Forms', path: '/forms', icon: ClipboardList, perm: 'forms.view' },
      { label: 'Form Rules', path: '/forms/rules', icon: Workflow, perm: 'forms.view' },
      { label: 'Metrics', path: '/metrics', icon: TrendingUp, perm: 'metrics.view' },
    ]},
    { label: 'Programs', items: [
      { label: 'Nutrition Plans', path: '/nutrition', icon: Apple, perm: 'nutrition.view' },
      { label: 'Exercise Plans', path: '/workouts', icon: Dumbbell, perm: 'workout.view' },
      { label: 'Food Database', path: '/foods', icon: Apple, perm: null },
      { label: 'Exercises', path: '/exercises', icon: Dumbbell, perm: null },
    ]},
    { label: 'Administration', items: [
      { label: 'Packages', path: '/packages', icon: Package, perm: null },
      { label: 'Notifications', path: '/notifications', icon: Bell, perm: null },
      { label: 'Settings', path: '/settings', icon: Settings, perm: 'settings.manage' },
    ]},
  ],
  coach: [
    { label: 'Overview', items: [
      { label: 'Dashboard', path: '/coach/dashboard', icon: LayoutDashboard, perm: null },
    ]},
    { label: 'Clients', items: [
      { label: 'My Clients', path: '/clients', icon: Users, perm: 'clients.view' },
      { label: 'Forms', path: '/forms', icon: ClipboardList, perm: 'forms.view' },
      { label: 'Metrics', path: '/metrics', icon: TrendingUp, perm: 'metrics.view' },
    ]},
    { label: 'Programs', items: [
      { label: 'Nutrition Plans', path: '/nutrition', icon: Apple, perm: 'nutrition.view' },
      { label: 'Exercise Plans', path: '/workouts', icon: Dumbbell, perm: 'workout.view' },
      { label: 'Exercises', path: '/exercises', icon: Dumbbell, perm: null },
    ]},
    { label: 'Administration', items: [
      { label: 'Notifications', path: '/notifications', icon: Bell, perm: null },
    ]},
  ],
};

export default function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const { user } = useAuth();
  const location = useLocation();
  const cat = getRoleCategory(user);
  const wsId = getActiveWorkspaceId(user);

  let sections = SECTIONS[cat] || SECTIONS.workspace;
  sections = sections.map((s) => ({
    ...s,
    items: s.items.map((it) => ({
      ...it,
      path: it.ws ? it.path.replace('__WS__', wsId || '') : it.path,
    })),
  }));

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.perm || hasPermission(user, item.perm)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        className={cn(
          'ybs-sidebar fixed lg:sticky top-0 left-0 z-50 h-dvh flex flex-col',
          'bg-sidebar border-r border-sidebar-border',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Logo */}
        <div className="h-20 flex items-center justify-between px-5 border-b border-sidebar-border shrink-0">
          <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center w-full')}>
            <motion.div
              className="ybs-monogram shrink-0"
              whileHover={{ scale: 1.08, rotate: 3 }}
              transition={{ duration: 0.2 }}
            >
              <span className="text-primary-foreground font-bold text-sm tracking-tight">Y</span>
            </motion.div>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  className="flex flex-col leading-none overflow-hidden"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="font-bold text-[15px] tracking-tight text-foreground whitespace-nowrap">YBS</span>
                  <span className="text-[12px] text-muted-foreground tracking-wider uppercase mt-0.5 whitespace-nowrap">Coaching OS</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button aria-label="Close navigation" className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace switcher */}
        {!collapsed && <div className="px-2 pt-3"><WorkspaceSwitcher collapsed={false} /></div>}
        {collapsed && <div className="pt-3"><WorkspaceSwitcher collapsed /></div>}

        {/* Nav */}
        <nav aria-label="Workspace navigation" className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
          {visibleSections.map((section, si) => (
            <div key={section.label}>
              <AnimatePresence>
                {!collapsed && (
                  <motion.p
                    className="px-3 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {section.label}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="space-y-0.5">
                {section.items.map((item, ii) => {
                  const candidates = visibleSections.flatMap((section) => section.items)
                    .filter((entry) => location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`));
                  const currentPath = candidates.sort((a, b) => b.path.length - a.path.length)[0]?.path;
                  const isActive = currentPath === item.path;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <motion.div
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] font-medium',
                          collapsed && 'justify-center',
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        whileHover={!isActive ? {
                          backgroundColor: 'hsl(var(--foreground)/0.04)',
                          x: 1,
                          transition: { duration: 0.15 }
                        } : {}}
                        transition={{ duration: 0.15 }}
                      >
                        <Icon className={cn(
                          'shrink-0 transition-colors duration-150',
                          collapsed ? 'w-[18px] h-[18px]' : 'w-[17px] h-[17px]',
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )} />
                        <AnimatePresence>
                          {!collapsed && (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="whitespace-nowrap overflow-hidden"
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {/* Active indicator dot */}
                        {isActive && collapsed && (
                          <motion.div
                            className="absolute right-1 w-1 h-1 rounded-full bg-primary"
                            layoutId="active-dot"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                          />
                        )}
                      </motion.div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden lg:block border-t border-sidebar-border p-2">
          <motion.button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            whileHover={{ backgroundColor: 'hsl(var(--foreground)/0.05)' }}
            whileTap={{ scale: 0.97 }}
          >
            <motion.div
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <ChevronLeft className="w-4 h-4" />
            </motion.div>
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  className="text-xs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  Collapse
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </motion.aside>
    </>
  );
}
