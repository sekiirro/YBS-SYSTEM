import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/utils/supabase';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
  Sparkles,
  MoreHorizontal,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DESKTOP_NAV = [
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

  // Mobile bottom navigation state + active-path derivation
  const [moreOpen, setMoreOpen] = useState(false);

  const isPathActive = (path, aliases = []) =>
    location.pathname === path || aliases.includes(location.pathname);

  const isTodayActive = isPathActive('/portal/dashboard');
  const isWorkoutActive = isPathActive('/portal/exercise', ['/portal/workout']);
  const isNutritionActive = isPathActive('/portal/nutrition');
  const isProgressActive = isPathActive('/portal/metrics', ['/portal/progress']);

  const secondaryNavItems = [
    {
      label: 'My Forms',
      desc: 'Check-ins & questionnaires',
      path: '/portal/forms',
      icon: ClipboardList,
      active: isPathActive('/portal/forms', ['/portal/assessments']),
    },
    {
      label: 'My Package',
      desc: 'Subscription & plan details',
      path: '/portal/package',
      icon: CreditCard,
      active: isPathActive('/portal/package', ['/portal/subscription']),
    },
    {
      label: 'Notifications',
      desc: 'Alerts & updates',
      path: '/portal/notifications',
      icon: Bell,
      active: isPathActive('/portal/notifications'),
    },
    {
      label: 'Profile',
      desc: 'Your account & preferences',
      path: '/portal/profile',
      icon: User,
      active: isPathActive('/portal/profile'),
    },
  ];

  const isSecondaryActive = secondaryNavItems.some((item) => item.active);

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
              {DESKTOP_NAV.map((item) => {
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

        {/* Main content container with mobile bottom safe area clearance */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] md:pb-8 max-w-7xl mx-auto w-full">
          <Outlet />
        </main>
      </div>

      {/* Mobile 5-Tab Bottom Navigation Bar */}
      <nav
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        className="md:hidden fixed bottom-0 inset-x-0 border-t border-border/80 bg-background/95 backdrop-blur-md z-30 flex items-center justify-around px-2 pt-1.5 shadow-2xl"
        aria-label="Mobile Bottom Navigation"
      >
        {/* 1. Today (Dashboard) */}
        <Link
          to="/portal/dashboard"
          className={cn(
            'flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[56px] min-h-[44px]',
            isTodayActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <div className={cn('p-1 rounded-lg transition-colors', isTodayActive && 'bg-primary/15')}>
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Today</span>
        </Link>

        {/* 2. Workout */}
        <Link
          to="/portal/exercise"
          className={cn(
            'flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[56px] min-h-[44px]',
            isWorkoutActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <div className={cn('p-1 rounded-lg transition-colors', isWorkoutActive && 'bg-primary/15')}>
            <Dumbbell className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Workout</span>
        </Link>

        {/* 3. Nutrition */}
        <Link
          to="/portal/nutrition"
          className={cn(
            'flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[56px] min-h-[44px]',
            isNutritionActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <div className={cn('p-1 rounded-lg transition-colors', isNutritionActive && 'bg-primary/15')}>
            <Apple className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Nutrition</span>
        </Link>

        {/* 4. Progress (Metrics) */}
        <Link
          to="/portal/metrics"
          className={cn(
            'flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[56px] min-h-[44px]',
            isProgressActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <div className={cn('p-1 rounded-lg transition-colors', isProgressActive && 'bg-primary/15')}>
            <TrendingUp className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Progress</span>
        </Link>

        {/* 5. More (Bottom Sheet Trigger) */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[56px] min-h-[44px]',
            isSecondaryActive || moreOpen ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label="More navigation options"
        >
          <div className={cn('p-1 rounded-lg transition-colors relative', (isSecondaryActive || moreOpen) && 'bg-primary/15')}>
            <MoreHorizontal className="w-5 h-5" />
            {isSecondaryActive && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
            )}
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">More</span>
        </button>
      </nav>

      {/* Mobile "More" Sheet Drawer */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-t border-border bg-card/98 backdrop-blur-xl p-0 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] max-h-[85vh] overflow-y-auto"
        >
          <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full mx-auto mt-3 mb-2" />
          <SheetHeader className="px-5 pt-1 pb-3 text-left border-b border-border/60">
            <SheetTitle className="text-base font-semibold font-display text-foreground flex items-center justify-between">
              <span>Client Portal Menu</span>
              <span className="text-[11px] font-mono font-normal text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">
                {user?.client_code || 'Athlete'}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="p-3 space-y-1">
            {secondaryNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl transition-all',
                    item.active
                      ? 'bg-primary/10 border border-primary/30 text-foreground'
                      : 'hover:bg-secondary/50 text-foreground border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      item.active ? 'bg-primary text-primary-foreground' : 'bg-secondary/80 text-muted-foreground'
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className={cn('text-sm font-medium', item.active && 'text-primary font-semibold')}>
                        {item.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{item.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>

          <div className="px-5 pt-3 pb-2 border-t border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold text-foreground">{clientName}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{user?.email}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                logout();
              }}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}