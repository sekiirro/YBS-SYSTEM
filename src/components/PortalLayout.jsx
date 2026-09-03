import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

import { LayoutDashboard, Dumbbell, Apple, TrendingUp, ClipboardList, CreditCard, Bell, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
  { label: 'My Workout', path: '/portal/workout', icon: Dumbbell },
  { label: 'My Nutrition', path: '/portal/nutrition', icon: Apple },
  { label: 'My Progress', path: '/portal/progress', icon: TrendingUp },
  { label: 'Assessments', path: '/portal/assessments', icon: ClipboardList },
  { label: 'Subscription', path: '/portal/subscription', icon: CreditCard },
  { label: 'Notifications', path: '/portal/notifications', icon: Bell },
  { label: 'Profile', path: '/portal/profile', icon: User },
];

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="h-16 border-b border-border flex items-center justify-between px-4 sticky top-0 bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-primary">
            <span className="text-primary-foreground font-bold text-sm font-display">Y</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-semibold text-[14px] tracking-tight">YBS</span>
            <span className="text-[9px] text-muted-foreground tracking-wider uppercase">Client Portal</span>
          </div>
        </div>
        <button
          onClick={() => { logout(); }}
          className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </header>

      <div className="flex flex-1">
        {/* Desktop side nav */}
        <aside className="hidden md:flex flex-col w-[220px] border-r border-border p-3 sticky top-16 h-[calc(100vh-4rem)]">
          <nav className="space-y-0.5">
            {NAV.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all',
                    isActive ? 'nav-item-active text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  )}
                >
                  <Icon className={cn('w-[18px] h-[18px]', isActive && 'text-primary')} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur z-30 flex items-center justify-around px-2 py-1.5">
        {NAV.slice(0, 5).map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} className={cn('flex flex-col items-center gap-0.5 px-2 py-1 rounded-md', isActive ? 'text-primary' : 'text-muted-foreground')}>
              <Icon className="w-5 h-5" />
              <span className="text-[9px]">{item.label.split(' ')[0]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}