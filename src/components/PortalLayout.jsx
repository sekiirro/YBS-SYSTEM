import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';

import {
  LayoutDashboard,
  ClipboardList,
  TrendingUp,
  Apple,
  Dumbbell,
  CreditCard,
  Bell,
  User,
  LogOut,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
  { label: 'My Forms', path: '/portal/forms', icon: ClipboardList },
  { label: 'My Metrics', path: '/portal/metrics', icon: TrendingUp },
  { label: 'Nutrition Plan', path: '/portal/nutrition', icon: Apple },
  { label: 'Exercise Plan', path: '/portal/exercise', icon: Dumbbell },
  { label: 'My Package', path: '/portal/package', icon: CreditCard },
  { label: 'Notifications', path: '/portal/notifications', icon: Bell },
  { label: 'Profile', path: '/portal/profile', icon: User },
];

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [workspaceName, setWorkspaceName] = useState('');

  useEffect(() => {
    let active = true;
    if (user?.active_workspace_id) {
      supabase
        .from('workspaces')
        .select('name')
        .eq('id', user.active_workspace_id)
        .maybeSingle()
        .then(({ data }) => {
          if (active && data?.name) setWorkspaceName(data.name);
        })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [user?.active_workspace_id]);

  // Derive client initials
  const clientName = user?.full_name || 'Trainee';
  const initials = clientName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'C';

  return (
    <div className="min-h-screen bg-background flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* Top bar */}
      <header className="h-16 border-b border-border/80 flex items-center justify-between px-4 lg:px-6 sticky top-0 bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-primary shadow-sm">
            <span className="text-primary-foreground font-bold text-sm font-display">Y</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-semibold text-[14px] tracking-tight text-foreground flex items-center gap-1.5">
              YBS <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wider">Coaching Portal</span>
            </span>
            {workspaceName ? (
              <span className="text-[11px] font-medium text-primary tracking-wide uppercase mt-0.5 truncate max-w-[200px] sm:max-w-xs">
                {workspaceName}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {user?.client_code || 'Client Workspace'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/portal/profile"
            className="flex items-center gap-2.5 px-2.5 py-1 rounded-full bg-secondary/50 border border-border/60 hover:border-primary/40 hover:bg-secondary/80 transition-all text-left"
          >
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-semibold">
              {initials}
            </div>
            <div className="hidden sm:flex flex-col leading-tight pr-1">
              <span className="text-[12px] font-medium text-foreground max-w-[120px] truncate">{clientName}</span>
              <span className="text-[9px] text-muted-foreground font-mono">{user?.client_code || 'Active Client'}</span>
            </div>
          </Link>

          <button
            onClick={() => { logout(); }}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-red-400 px-2.5 py-1.5 rounded-md hover:bg-red-500/10 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop side nav */}
        <aside className="hidden md:flex flex-col w-[230px] border-r border-border/80 p-3.5 sticky top-16 h-[calc(100vh-4rem)] shrink-0 justify-between bg-sidebar/50">
          <div>
            <div className="px-3 py-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary/70" />
              <span>Personal Portal</span>
            </div>
            <nav className="space-y-0.5">
              {NAV.map((item) => {
                const isActive = location.pathname === item.path ||
                  (item.path === '/portal/forms' && location.pathname === '/portal/assessments') ||
                  (item.path === '/portal/metrics' && location.pathname === '/portal/progress') ||
                  (item.path === '/portal/exercise' && location.pathname === '/portal/workout') ||
                  (item.path === '/portal/package' && location.pathname === '/portal/subscription');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all',
                      isActive
                        ? 'nav-item-active text-foreground font-semibold bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                    )}
                  >
                    <Icon className={cn('w-[18px] h-[18px] transition-transform duration-200', isActive ? 'text-primary scale-105' : 'text-muted-foreground')} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Sidebar footer badge */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/40 text-center">
            <p className="text-[11px] font-medium text-foreground">YBS System v1.0</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Continuous Improvement</p>
          </div>
        </aside>

        {/* Main content container */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden pb-24 md:pb-8 max-w-7xl mx-auto w-full">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border/80 bg-background/95 backdrop-blur z-30 flex items-center justify-around px-1 py-1.5 shadow-lg">
        {NAV.slice(0, 6).map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path === '/portal/forms' && location.pathname === '/portal/assessments') ||
            (item.path === '/portal/metrics' && location.pathname === '/portal/progress') ||
            (item.path === '/portal/exercise' && location.pathname === '/portal/workout') ||
            (item.path === '/portal/package' && location.pathname === '/portal/subscription');
          const Icon = item.icon;
          const shortLabel = item.label.replace('My ', '').replace(' Plan', '');
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1 rounded-md transition-colors min-w-[50px]',
                isActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] tracking-tight">{shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}