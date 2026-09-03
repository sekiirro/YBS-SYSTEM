import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getLandingPath } from '@/lib/ybs-auth';

// Root redirect: sends the authenticated user to their role-aware landing page.
export default function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getLandingPath(user)} replace />;
}