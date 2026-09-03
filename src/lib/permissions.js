// YBS Permission system — hybrid RBAC + granular permissions.
// UI-level gating that mirrors server-side RLS. Server-side RLS is the real enforcement.

import { isPlatformAdmin, isPlatformTrainer, isClient, getRoleCategory } from './ybs-auth';

export const PERMISSIONS = {
  'clients.view': 'View clients',
  'clients.create': 'Create clients',
  'clients.update': 'Update clients',
  'clients.delete': 'Delete clients',
  'clients.assign': 'Assign clients to trainers',
  'clients.reassign': 'Reassign clients between trainers',
  'forms.view': 'View forms',
  'forms.create': 'Create forms',
  'forms.update': 'Update forms',
  'forms.delete': 'Delete forms',
  'forms.review': 'Review form submissions',
  'forms.assign': 'Assign forms to clients',
  'metrics.view': 'View metrics',
  'metrics.update': 'Update metrics',
  'nutrition.view': 'View nutrition plans',
  'nutrition.create': 'Create nutrition plans',
  'nutrition.update': 'Update nutrition plans',
  'nutrition.fooddb': 'Manage food database',
  'workout.view': 'View workout plans',
  'workout.create': 'Create workout plans',
  'workout.update': 'Update workout plans',
  'workout.exercise': 'Manage exercise library',
  'templates.create': 'Create templates',
  'templates.manage': 'Manage all templates',
  'team.manage': 'Manage team members',
  'team.permissions': 'Manage user permissions',
  'workspaces.view': 'View workspaces',
  'workspaces.create': 'Create workspaces',
  'workspaces.manage': 'Manage workspaces',
  'workspaces.suspend': 'Suspend workspaces',
  'applications.view': 'View applications',
  'applications.approve': 'Approve applications',
  'applications.reject': 'Reject applications',
  'financials.view': 'View financial data',
  'financials.manage': 'Manage payments',
  'exports.create': 'Export data',
  'audit.view': 'View audit logs',
  'settings.manage': 'Manage organization settings',
};

export function hasPermission(user, permission) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  const customPerms = user.permissions || [];
  return customPerms.includes(permission);
}

export function hasAnyPermission(user, permissions) {
  return permissions.some((p) => hasPermission(user, p));
}

export const isOwner = isPlatformAdmin;
export function isManager(user) { return getRoleCategory(user) === 'workspace' && !!hasPermission(user, 'team.manage'); }
export function isTrainer(user) { return getRoleCategory(user) === 'workspace' || isPlatformTrainer(user); }
export { isClient, isPlatformTrainer, isPlatformAdmin };

export function canViewFinancials(user) {
  return hasPermission(user, 'financials.view');
}

export function canManageTeam(user) {
  return hasPermission(user, 'team.manage');
}

export function canManageWorkspaces(user) {
  return hasPermission(user, 'workspaces.manage');
}

export function canReviewApplications(user) {
  return hasPermission(user, 'applications.approve');
}

// Scope filter for client queries — trainers/coaches only see assigned clients.
// RLS enforces this server-side; this is a frontend hint for clarity.
export function getClientFilterForUser(user) {
  if (isPlatformTrainer(user)) {
    return { assigned_ybs_coach_id: user.id };
  }
  if (getRoleCategory(user) === 'workspace') {
    // Workspace owners/managers see all clients in their workspace (RLS-scoped).
    return {};
  }
  return {};
}