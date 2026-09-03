const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createAuditLog } from '../../shared/auth.ts';

// Platform admin rejects a coach application.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await db.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const applicationId = body && body.applicationId;
    const reason = (body && body.reason) || '';
    if (!applicationId) return Response.json({ error: 'applicationId required' }, { status: 400 });

    const app = await db.asServiceRole.entities.CoachApplication.get(applicationId);
    if (!app) return Response.json({ error: 'Application not found' }, { status: 404 });

    const now = new Date().toISOString();
    await db.asServiceRole.entities.CoachApplication.update(app.id, {
      status: 'rejected',
      rejection_reason: reason,
      reviewed_at: now,
      reviewed_by: user.id,
      reviewed_by_name: user.full_name || user.email,
    });
    await db.asServiceRole.entities.User.update(app.user_id, { account_status: 'rejected' });

    await createAuditLog(base44, {
      actor_id: user.id, actor_name: user.full_name || user.email, actor_role: user.role,
      action: 'application_rejected', entity_type: 'CoachApplication',
      entity_id: app.id, entity_name: app.applicant_name, metadata: { reason },
    });
    try {
      await db.asServiceRole.entities.Notification.create({
        user_id: app.user_id, type: 'application_rejected',
        title: 'Application rejected',
        message: reason ? ('Your application was not approved: ' + reason) : 'Your application was not approved at this time.',
        is_read: false, delivery_channel: 'in_app',
      });
    } catch (e) { console.error('notify failed', e.message); }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Rejection failed' }, { status: 500 });
  }
}