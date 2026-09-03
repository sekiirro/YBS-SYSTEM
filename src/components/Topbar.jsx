import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, LogOut, ChevronDown, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getInitials } from '@/lib/ybs-utils';
import { cn } from '@/lib/utils';

export default function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const getDisplayRole = () => {
    if (user?.platform_role === 'platform_owner') return 'Platform Owner';
    if (user?.platform_role === 'platform_trainer') return 'YBS Coach';
    if (user?.managed_workspace_ids?.length > 0) return 'Workspace Owner';
    if (user?.self_client_id) return 'Client';
    return 'User';
  };

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

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
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
              <div className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[13px] font-medium text-foreground truncate">{user?.full_name || 'User'}</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
                </div>
                <div className="py-1">
                  <button className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
                    <UserIcon className="w-4 h-4" /> Profile
                  </button>
                  <button
                    onClick={() => logout()}
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