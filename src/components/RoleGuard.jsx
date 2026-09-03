import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getRoleCategory, getAccountStatus } from '@/lib/ybs-auth';

// Route guard: restricts a route group to the given role categories.
// allow: array of 'admin' | 'coach' | 'workspace' | 'client'
export default function RoleGuard({ allow }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const status = getAccountStatus(user);
  if (status !== 'active' && !isPlatformAdmin(user)) {
    return <Navigate to="/pending" replace />;
  }
  const cat = getRoleCategory(user);
  if (!allow.includes(cat)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

function isPlatformAdmin(user) {
  return user && (user.role === 'admin' || user.platform_role === 'platform_owner' || user.platform_role === 'platform_manager');
}