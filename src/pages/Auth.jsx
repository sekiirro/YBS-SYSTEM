import React from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getLandingPath } from "@/lib/ybs-auth";
import { LoadingState } from "@/components/ui";
import AuthShell, { AuthStatusCard } from "@/components/auth/AuthShell";
import LoginForm from "@/components/auth/LoginForm";

// Shared authentication entry: `/` and `/login` render the exact same YBS
// hero shell as invitation registration — only the right-side card differs.
// Authenticated visitors are sent on to their workspace (preserves the old
// Landing redirect behavior).
export function AuthLogin() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const { search } = useLocation();
  if (isLoadingAuth) return <LoadingState label="Opening YBS…" />;
  if (isAuthenticated && user) return <Navigate to={getLandingPath(user)} replace />;

  return (
    <AuthShell
      workspaceName="Coaching OS"
      loginTarget={`/login${search}`}
      panelKicker="Welcome back"
      panelTitle="Log in"
      panelTitleId="login-heading"
      panelSub="Sign in to your YBS workspace."
    >
      <LoginForm />
    </AuthShell>
  );
}

// Public registration is disabled: account creation is invitation-only.
// Anyone reaching /register without a token lands here — no form, just a
// login path back into the shared shell.
export function AuthNoInvite() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return <LoadingState label="Opening YBS…" />;
  if (isAuthenticated && user) return <Navigate to={getLandingPath(user)} replace />;

  return (
    <AuthStatusCard
      icon={KeyRound}
      eyebrow="Invitation only"
      title="Registration needs an invitation"
      description="YBS accounts are created through a personal registration link from your coach. If you already have an account, sign in to continue."
      action={<Link to="/login" className="registration-primary-action">Go to Login</Link>}
    />
  );
}
