const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createAuditLog } from '../../shared/auth.ts';

// Platform admin approves a coach application. Transactional:
// application -> APPROVED, user -> active, workspace created, owner membership,
// user denormalized workspace fields, audit log, notification.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await db.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const applicationId = body && body.applicationId;
    const platformPlan = (body && body.platformPlan) || 'starter';
    if (!applicationId) return Response.json({ error: 'applicationId required' }, { status: 400 });

    const app = await db.asServiceRole.entities.CoachApplication.get(applicationId);
    if (!app) return Response.json({ error: 'Application not found' }, { status: 404 });
    if (app.status === 'approved') return Response.json({ error: 'Already approved' }, { status: 409 });
    if (app.status === 'rejected') return Response.json({ error: 'Application was rejected' }, { status: 409 });

    const now = new Date().toISOString();

    // 1. Create the workspace.
    const workspace = await db.asServiceRole.entities.Workspace.create({
      name: app.desired_workspace_name || (app.applicant_name + "'s Workspace"),
      owner_id: app.user_id,
      owner_name: app.applicant_name,
      owner_phone: app.applicant_phone,
      owner_email: app.applicant_email,
      status: 'active',
      platform_plan: platformPlan,
      country: app.country || '',
      city: app.city || '',
      client_count: 0,
      assigned_ybs_coaches: [],
      settings: { default_follow_up_day: 'saturday', timezone: 'Africa/Cairo', currency: 'EGP' },
      created_by_application_id: app.id,
    });

    // 2. Create the owner membership.
    await db.asServiceRole.entities.WorkspaceMembership.create({
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      user_id: app.user_id,
      user_name: app.applicant_name,
      user_email: app.applicant_email,
      workspace_role: 'workspace_owner',
      status: 'active',
      permissions: [],
      assigned_client_count: 0,
    });

    // 3. Activate the applicant account + denormalize workspace fields.
    await db.asServiceRole.entities.User.update(app.user_id, {
      account_status: 'active',
      platform_role: 'none',
      workspace_ids: [workspace.id],
      managed_workspace_ids: [workspace.id],
      active_workspace_id: workspace.id,
      phone: app.applicant_phone,
    });

    // 4. Mark application approved.
    await db.asServiceRole.entities.CoachApplication.update(app.id, {
      status: 'approved',
      reviewed_at: now,
      reviewed_by: user.id,
      reviewed_by_name: user.full_name || user.email,
      created_workspace_id: workspace.id,
    });

    // 5. Audit + notify.
    await createAuditLog(base44, {
      actor_id: user.id, actor_name: user.full_name || user.email, actor_role: user.role,
      action: 'application_approved', entity_type: 'CoachApplication',
      entity_id: app.id, entity_name: app.applicant_name, workspace_id: workspace.id,
      metadata: { workspace_id: workspace.id, workspace_name: workspace.name },
    });
    await createAuditLog(base44, {
      actor_id: user.id, actor_name: user.full_name || user.email, actor_role: user.role,
      action: 'workspace_created', entity_type: 'Workspace',
      entity_id: workspace.id, entity_name: workspace.name, workspace_id: workspace.id,
      metadata: { owner_id: app.user_id, plan: platformPlan },
    });
    try {
      await db.asServiceRole.entities.Notification.create({
        user_id: app.user_id, workspace_id: workspace.id,
        type: 'application_approved',
        title: 'Application approved',
        message: 'Your coaching application has been approved. Your workspace "' + workspace.name + '" is ready.',
        is_read: false, delivery_channel: 'in_app',
      });
    } catch (e) { console.error('notify failed', e.message); }

    return Response.json({ ok: true, workspaceId: workspace.id, workspaceName: workspace.name });
  } catch (error) {
    return Response.json({ error: error.message || 'Approval failed' }, { status: 500 });
  }
}