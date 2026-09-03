const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createAuditLog } from '../../shared/auth.ts';

// Platform admin requests more information from an applicant.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await db.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const applicationId = body && body.applicationId;
    const requestText = (body && body.request) || '';
    if (!applicationId || !requestText) return Response.json({ error: 'applicationId and request required' }, { status: 400 });

    const app = await db.asServiceRole.entities.CoachApplication.get(applicationId);
    if (!app) return Response.json({ error: 'Application not found' }, { status: 404 });

    await db.asServiceRole.entities.CoachApplication.update(app.id, {
      status: 'more_info_required',
      more_info_request: requestText,
      more_info_response: '',
    });

    await createAuditLog(base44, {
      actor_id: user.id, actor_name: user.full_name || user.email, actor_role: user.role,
      action: 'more_info_requested', entity_type: 'CoachApplication',
      entity_id: app.id, entity_name: app.applicant_name, metadata: { request: requestText },
    });
    try {
      await db.asServiceRole.entities.Notification.create({
        user_id: app.user_id, type: 'more_info_requested',
        title: 'More information requested',
        message: 'Please provide additional information to continue your application review.',
        is_read: false, delivery_channel: 'in_app',
        related_entity_type: 'CoachApplication', related_entity_id: app.id,
      });
    } catch (e) { console.error('notify failed', e.message); }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Request failed' }, { status: 500 });
  }
}