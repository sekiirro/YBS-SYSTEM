import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { LoadingState } from '@/components/ui';

export default function ProtectedRoute({
  fallback = (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <LoadingState label="Verifying authentication…" />
    </div>
  ),
  unauthenticatedElement = <Navigate to="/login" replace />,
}) {
  const { isAuthenticated, isLoadingAuth, user } = useAuth();

  if (isLoadingAuth) {
    return fallback;
  }

  if (!isAuthenticated || !user) {
    return unauthenticatedElement;
  }

  return <Outlet />;
}
