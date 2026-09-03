const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createAuditLog } from '../../shared/auth.ts';

// Platform owner approves a client application and assigns workspace + YBS trainer.
// Creates the Client record, activates the user, denormalizes workspace fields, audits, notifies.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await db.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const applicationId = body && body.applicationId;
    const workspaceId = body && body.workspaceId;
    const trainerId = (body && body.trainerId) || '';
    if (!applicationId || !workspaceId) return Response.json({ error: 'applicationId and workspaceId required' }, { status: 400 });

    const app = await db.asServiceRole.entities.ClientApplication.get(applicationId);
    if (!app) return Response.json({ error: 'Application not found' }, { status: 404 });
    if (app.status === 'approved') return Response.json({ error: 'Already approved' }, { status: 409 });

    const ws = await db.asServiceRole.entities.Workspace.get(workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (ws.status !== 'active') return Response.json({ error: 'Workspace is not active' }, { status: 400 });

    let trainer = null;
    if (trainerId) {
      trainer = await db.asServiceRole.entities.User.get(trainerId);
      if (!trainer) return Response.json({ error: 'Trainer not found' }, { status: 404 });
    }

    // Generate next client code.
    const existing = await db.asServiceRole.entities.Client.list('-created_date', 500);
    let max = 0;
    existing.forEach((c) => {
      const n = parseInt(String(c.client_code || '').replace('YBS-', ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    const clientCode = `YBS-${String(max + 1).padStart(4, '0')}`;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const client = await db.asServiceRole.entities.Client.create({
      client_code: clientCode,
      full_name: app.applicant_name,
      phone: app.applicant_phone,
      email: app.applicant_email,
      workspace_id: ws.id,
      workspace_name: ws.name,
      user_id: app.user_id,
      assigned_ybs_coach_id: trainerId,
      assigned_ybs_coach_name: trainer ? (trainer.full_name || trainer.email) : '',
      join_date: today,
      status: 'active',
      subscription_status: 'no_subscription',
    });

    await db.asServiceRole.entities.User.update(app.user_id, {
      account_status: 'active',
      self_client_id: client.id,
      workspace_ids: [ws.id],
      active_workspace_id: ws.id,
      phone: app.applicant_phone,
    });

    await db.asServiceRole.entities.ClientApplication.update(app.id, {
      status: 'approved',
      assigned_workspace_id: ws.id,
      assigned_workspace_name: ws.name,
      assigned_ybs_trainer_id: trainerId,
      assigned_ybs_trainer_name: trainer ? (trainer.full_name || trainer.email) : '',
      reviewed_at: now,
      reviewed_by: user.id,
      reviewed_by_name: user.full_name || user.email,
      created_client_id: client.id,
    });

    await db.asServiceRole.entities.Workspace.update(ws.id, { client_count: (ws.client_count || 0) + 1 });

    await createAuditLog(base44, {
      actor_id: user.id, actor_name: user.full_name || user.email, actor_role: user.role,
      action: 'client_application_approved', entity_type: 'ClientApplication',
      entity_id: app.id, entity_name: app.applicant_name, workspace_id: ws.id,
      metadata: { client_id: client.id, client_code: clientCode, trainer_id: trainerId },
    });

    try {
      await db.asServiceRole.entities.Notification.create({
        user_id: app.user_id, workspace_id: ws.id,
        type: 'application_approved',
        title: 'Application approved',
        message: `Your account has been approved. You are now part of ${ws.name}.`,
        is_read: false, delivery_channel: 'in_app',
      });
    } catch (e) { console.error('notify failed', e.message); }

    return Response.json({ ok: true, clientId: client.id, clientCode });
  } catch (error) {
    return Response.json({ error: error.message || 'Approval failed' }, { status: 500 });
  }
}