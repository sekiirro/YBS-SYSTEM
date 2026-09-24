import React, { useState, useEffect, Suspense } from 'react';
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
  Bell,
  User,
  LogOut,
  Sparkles,
  MoreHorizontal,
  ChevronRight,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ThemeControl from '@/components/ThemeControl';
import { LoadingState } from '@/components/ui';

const DESKTOP_NAV = [
  { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
  { label: 'My Forms', path: '/portal/forms', icon: ClipboardList },
  { label: 'My Metrics', path: '/portal/metrics', icon: TrendingUp },
  { label: 'Nutrition Plan', path: '/portal/nutrition', icon: Apple },
  { label: 'Exercise Plan', path: '/portal/exercise', icon: Dumbbell },
  { label: 'Notifications', path: '/portal/notifications', icon: Bell },
  { label: 'Profile', path: '/portal/profile', icon: User },
];

// Shown only while a lazily-loaded portal route chunk downloads. Matches the
// app's existing loading state so the portal chrome never blinks.
const RouteFallback = () => <LoadingState label="Loading…" />;

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
  const clientDisplayName = clientName.split(' ').filter(Boolean).slice(0, 2).join(' ');
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

  // The client dashboard renders its own cinematic chrome (dedicated top
  // navigation). Bypass the standard portal header/sidebar/bottom-nav for
  // that route only — every other portal view keeps the existing layout.
  if (location.pathname === '/portal/dashboard' || location.pathname === '/portal/nutrition' || location.pathname === '/portal/forms' || location.pathname === '/portal/assessments' || location.pathname === '/portal/exercise' || location.pathname === '/portal/workout' || location.pathname === '/portal/metrics' || location.pathname === '/portal/progress') {
    return (
      <div className="ybs-portal min-h-screen flex flex-col">
        <a className="ybs-skip" href="#portal-content">Skip to content</a>
        <main id="portal-content" className="flex-1 w-full min-w-0">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    );
  }

  return (
    <div className="ybs-portal min-h-screen flex flex-col selection:bg-primary/20 selection:text-primary">
      <a className="ybs-skip" href="#portal-content">Skip to content</a>
      {/* Top bar */}
      <header className="ybs-portal-header border-b border-border/80 flex items-center justify-between sticky top-0 backdrop-blur z-30">
        <div className="flex items-center gap-3">
          <div className="ybs-monogram shrink-0">
            <span className="text-primary-foreground font-bold text-sm font-display">Y</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-semibold text-[14px] tracking-tight text-foreground flex items-center gap-1.5">
              YBS <span className="hidden sm:inline text-[12px] font-normal text-muted-foreground uppercase tracking-wider">Coaching Portal</span>
            </span>
            {workspaceName ? (
              <span className="text-[12px] font-medium text-primary tracking-wide uppercase mt-0.5 truncate max-w-[120px] max-[400px]:max-w-[80px] sm:max-w-xs">
                {workspaceName}
              </span>
            ) : (
              <span className="text-[12px] text-muted-foreground font-mono mt-0.5">
                {user?.client_code || 'Client Workspace'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/portal/notifications"
            aria-label="Notifications"
            className="grid h-11 w-11 place-items-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
          </Link>
          <details className="group relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-full border border-border/60 bg-secondary/50 py-1 pl-1 pr-3 text-left transition-all hover:border-primary/40 hover:bg-secondary/80">
              {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{initials}</div>}
              <div className="hidden flex-col leading-tight sm:flex">
                <span className="max-w-[150px] truncate text-xs font-semibold text-foreground">{clientDisplayName}</span>
                <span className="text-[11px] text-muted-foreground">Client</span>
              </div>
              <ChevronRight className="hidden h-3.5 w-3.5 rotate-90 text-muted-foreground sm:block" />
            </summary>
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-2xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl">
              <Link to="/portal/profile" className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm text-foreground hover:bg-secondary"><Settings className="h-4 w-4" /> Settings</Link>
              <Link to="/portal/notifications" className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm text-foreground hover:bg-secondary"><Bell className="h-4 w-4" /> Notifications</Link>
              <div className="flex min-h-11 items-center justify-between rounded-xl px-3"><span className="text-sm text-foreground">Appearance</span><ThemeControl /></div>
              <button type="button" onClick={() => logout()} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-red-400 hover:bg-red-500/10"><LogOut className="h-4 w-4" /> Log out</button>
            </div>
          </details>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop side nav */}
        <aside className="ybs-portal-sidebar hidden md:flex flex-col border-r border-border/80 sticky shrink-0 justify-between bg-sidebar/50">
          <div>
            <div className="px-3 py-1.5 mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary/70" />
              <span>Personal Portal</span>
            </div>
            <nav className="space-y-0.5" aria-label="Client portal">
              {DESKTOP_NAV.map((item) => {
                const isActive = location.pathname === item.path ||
                  (item.path === '/portal/forms' && location.pathname === '/portal/assessments') ||
                  (item.path === '/portal/metrics' && location.pathname === '/portal/progress') ||
                  (item.path === '/portal/exercise' && location.pathname === '/portal/workout');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all',
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
          <div className="px-3 pt-6 border-t border-border/60">
            <p className="text-sm font-semibold text-foreground">Built around you.</p>
            <p className="text-xs text-muted-foreground mt-1">Your coaching. Your progress.</p>
          </div>
        </aside>

{/* Main content container with mobile bottom safe area clearance */}
        <main id="portal-content" className="ybs-portal-main flex-1 mx-auto w-full">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Mobile 5-Tab Bottom Navigation Bar */}
      <nav
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        className="ybs-bottom-nav md:hidden fixed bottom-0 inset-x-0 border-t border-border/80 backdrop-blur-md z-30 flex items-center justify-around px-2 pt-1.5"
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
          <span className="text-[12px] tracking-tight mt-0.5">Today</span>
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
          <span className="text-[12px] tracking-tight mt-0.5">Workout</span>
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
          <span className="text-[12px] tracking-tight mt-0.5">Nutrition</span>
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
          <span className="text-[12px] tracking-tight mt-0.5">Progress</span>
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
          <span className="text-[12px] tracking-tight mt-0.5">More</span>
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
              <span className="text-[12px] font-mono font-normal text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">
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
                      <p className="text-[12px] text-muted-foreground line-clamp-1">{item.desc}</p>
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
                <span className="text-[12px] text-muted-foreground font-mono">{user?.email}</span>
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
