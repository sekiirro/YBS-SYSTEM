import React from "react";
import { useLocation } from "react-router-dom";
import AuthShell, {
  HERO_BASE_IMAGE,
  HERO_REVEAL_IMAGE,
  PackageSummary,
} from "@/components/auth/AuthShell";
import RegistrationForm from "@/components/auth/RegistrationForm";

// Re-exported for backwards compatibility (JoinWorkspace imports the hero
// assets from this module).
export { HERO_BASE_IMAGE, HERO_REVEAL_IMAGE };

// Invitation-only client registration. Rendered for validated invitation
// links (e.g. /join/:token) inside the shared YBS authentication shell —
// the same hero/layout as Login, with the registration form in the
// right-side card plus the invitation package summary.
export default function ClientSignup({ workspace = null, joinToken = null }) {
  const location = useLocation();

  const isScopedLink = !!(workspace && workspace.package_tier);
  const workspaceName = workspace?.workspace_name || workspace?.brand_name || "YBS Coaching";
  const packageName = workspace?.package_name || (workspace?.package_tier ? `${workspace.package_tier} Coaching` : "Client Coaching");
  const duration = workspace?.package_duration
    ? `${workspace.package_duration} month${workspace.package_duration === 1 ? "" : "s"}`
    : "Application access";
  const loginTarget = `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;

  const packageSummary = (
    <PackageSummary
      workspace={workspace}
      packageName={packageName}
      duration={duration}
      workspaceName={workspaceName}
      isScopedLink={isScopedLink}
    />
  );

  return (
    <AuthShell
      workspaceName={workspaceName}
      loginTarget={loginTarget}
      panelKicker="Client application"
      panelTitle="Create your account"
      panelTitleId="application-heading"
      panelSub={isScopedLink ? `Apply to join ${workspaceName}.` : "Request access to your coaching workspace."}
      packageSummary={packageSummary}
    >
      <RegistrationForm workspace={workspace} joinToken={joinToken} loginTarget={loginTarget} />
    </AuthShell>
  );
}
