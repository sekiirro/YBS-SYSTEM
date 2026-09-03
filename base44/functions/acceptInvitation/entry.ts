const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createAuditLog } from '../../shared/auth.ts';

// Called by a newly-registered client user after they set a password + verify OTP.
// Links their new account to the client record, activates the account, and
// denormalizes workspace fields so RLS grants them access to their own data.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await db.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized — please complete account setup first' }, { status: 401 });

    const body = await req.json();
    const token = body && body.token;
    if (!token) return Response.json({ error: 'Token required' }, { status: 400 });

    const list = await db.asServiceRole.entities.ClientInvitation.filter({ token });
    const inv = list && list[0];
    if (!inv) return Response.json({ error: 'Invalid invitation' }, { status: 404 });
    if (inv.status === 'used') return Response.json({ error: 'Invitation already used' }, { status: 410 });
    if (inv.status === 'revoked') return Response.json({ error: 'Invitation revoked' }, { status: 403 });
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return Response.json({ error: 'Invitation expired' }, { status: 410 });
    }

    const now = new Date().toISOString();

    // Link the client record to the new user account.
    await db.asServiceRole.entities.Client.update(inv.client_id, {
      user_id: user.id,
      email: user.email || inv.client_email,
      phone: inv.client_phone || user.data?.phone || '',
    });

    // Activate the user + denormalize workspace membership (member, not manager).
    const existingWs = Array.isArray(user.data?.workspace_ids) ? user.data.workspace_ids : [];
    if (!existingWs.includes(inv.workspace_id)) existingWs.push(inv.workspace_id);
    await db.asServiceRole.entities.User.update(user.id, {
      account_status: 'active',
      self_client_id: inv.client_id,
      workspace_ids: existingWs,
      active_workspace_id: inv.workspace_id,
      phone: inv.client_phone || user.data?.phone || '',
    });

    // Create the client membership record.
    try {
      await db.asServiceRole.entities.WorkspaceMembership.create({
        workspace_id: inv.workspace_id,
        workspace_name: inv.workspace_name,
        user_id: user.id,
        user_name: inv.client_name,
        user_email: user.email || inv.client_email,
        workspace_role: 'client',
        status: 'active',
        permissions: [],
      });
    } catch (e) { console.error('membership create failed', e.message); }

    // Mark invitation used.
    await db.asServiceRole.entities.ClientInvitation.update(inv.id, {
      status: 'used',
      used_at: now,
    });

    await createAuditLog(base44, {
      actor_id: user.id, actor_name: inv.client_name, actor_role: 'client',
      action: 'client_activated', entity_type: 'Client',
      entity_id: inv.client_id, entity_name: inv.client_name, workspace_id: inv.workspace_id,
      metadata: { invitation_id: inv.id },
    });

    return Response.json({ ok: true, client_id: inv.client_id, workspace_id: inv.workspace_id });
  } catch (error) {
    return Response.json({ error: error.message || 'Activation failed' }, { status: 500 });
  }
}