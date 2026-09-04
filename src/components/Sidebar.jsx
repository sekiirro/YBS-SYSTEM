import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, ClipboardList, TrendingUp,
  Apple, Dumbbell, Bell, UsersRound, ScrollText, Settings,
  Building2, ClipboardCheck, ChevronLeft, X
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
  // Resolve workspace placeholder in dashboard path.
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
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen flex flex-col',
          'bg-sidebar border-r border-sidebar-border transition-all duration-300',
          collapsed ? 'w-[64px]' : 'w-[220px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border shrink-0">
          <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center w-full')}>
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 glow-primary">
              <span className="text-primary-foreground font-bold text-sm tracking-tight font-display">Y</span>
            </div>
            {!collapsed && (
              <div className="flex flex-col leading-none">
                <span className="font-display font-semibold text-[15px] tracking-tight text-foreground">YBS</span>
                <span className="text-[10px] text-muted-foreground tracking-wider uppercase mt-0.5">Coaching OS</span>
              </div>
            )}
          </div>
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace switcher */}
        {!collapsed && <div className="px-2 pt-3"><WorkspaceSwitcher collapsed={false} /></div>}
        {collapsed && <div className="pt-3"><WorkspaceSwitcher collapsed /></div>}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
          {visibleSections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{section.label}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path ||
                    (item.path !== '/' && item.path !== '/admin/dashboard' && item.path !== '/coach/dashboard' && !item.path.endsWith('/dashboard') && location.pathname.startsWith(item.path));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all',
                        collapsed && 'justify-center',
                        isActive ? 'nav-item-active text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className={cn('w-[18px] h-[18px] shrink-0', isActive && 'text-primary')} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden lg:block border-t border-sidebar-border p-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && <span className="text-xs">Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}