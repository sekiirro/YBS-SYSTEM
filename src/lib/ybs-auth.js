// YBS role resolution + role-aware redirect destinations.
// Distinguishes platform-level (admin/coach) from workspace-level and client access.

export function getAccountStatus(user) {
  if (!user) return 'unknown';
  if (user.role === 'admin') return 'active';
  if (user.status === 'disabled') return 'suspended';
  return user.account_status || 'active';
}

export function isPlatformAdmin(user) {
  return !!user && (user.role === 'admin' || user.platform_role === 'platform_owner' || user.platform_role === 'platform_manager');
}

export function isPlatformTrainer(user) {
  return !!user && (user.platform_role === 'platform_trainer' || user.ybs_coach === true);
}

export function isWorkspaceMember(user) {
  if (!user || isPlatformAdmin(user) || isPlatformTrainer(user)) return false;
  const managed = Array.isArray(user.managed_workspace_ids) ? user.managed_workspace_ids : [];
  const all = Array.isArray(user.workspace_ids) ? user.workspace_ids : [];
  return managed.length > 0 || all.length > 0;
}

export function isClient(user) {
  return !!user && !!user.self_client_id;
}

// One of: 'admin' | 'coach' | 'workspace' | 'client' | 'unknown'
export function getRoleCategory(user) {
  if (!user) return 'unknown';
  if (isPlatformAdmin(user)) return 'admin';
  if (isPlatformTrainer(user)) return 'coach';
  if (isClient(user)) return 'client';
  if (isWorkspaceMember(user)) return 'workspace';
  return 'unknown';
}

export function getActiveWorkspaceId(user) {
  if (!user) return null;
  return user.active_workspace_id
    || (user.managed_workspace_ids && user.managed_workspace_ids[0])
    || (user.workspace_ids && user.workspace_ids[0])
    || null;
}

export function getLandingPath(user) {
  if (!user) return '/login';
  const status = getAccountStatus(user);
  if (status === 'pending_approval') return '/pending';
  if (status === 'suspended' || status === 'rejected' || status === 'deactivated') return '/pending';
  const cat = getRoleCategory(user);
  if (cat === 'admin') return '/admin/dashboard';
  if (cat === 'coach') return '/coach/dashboard';
  if (cat === 'client') return '/portal/dashboard';
  if (cat === 'workspace') {
    const wsId = getActiveWorkspaceId(user);
    return wsId ? `/workspace/${wsId}/dashboard` : '/pending';
  }
  return '/pending';
}

// Permission keys for the extended platform/workspace model.
export const PLATFORM_PERMISSIONS = [
  'workspaces.view', 'workspaces.create', 'workspaces.manage', 'workspaces.suspend',
  'applications.view', 'applications.approve', 'applications.reject',
  'platform.users.manage', 'platform.financials.view',
];

export const WORKSPACE_PERMISSIONS = [
  'clients.view', 'clients.create', 'clients.update', 'clients.delete', 'clients.assign', 'clients.reassign',
  'subscriptions.view', 'subscriptions.create', 'subscriptions.update', 'subscriptions.freeze', 'subscriptions.cancel',
  'assessments.view', 'assessments.create', 'assessments.update', 'assessments.review', 'assessments.assign',
  'metrics.view', 'metrics.update',
  'nutrition.view', 'nutrition.create', 'nutrition.update', 'nutrition.fooddb',
  'workouts.view', 'workouts.create', 'workouts.update', 'workouts.exercise',
  'team.view', 'team.manage',
  'financials.view', 'financials.manage',
  'exports.create', 'settings.manage',
];