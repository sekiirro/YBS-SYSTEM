const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Public: verifies an invitation token and returns client/workspace info.
// Does not require authentication (the client is not logged in yet).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || (await safeBody(req)).token;
    if (!token) return Response.json({ error: 'Token required' }, { status: 400 });

    const list = await db.asServiceRole.entities.ClientInvitation.filter({ token });
    const inv = list && list[0];
    if (!inv) return Response.json({ error: 'Invalid invitation' }, { status: 404 });
    if (inv.status === 'used') return Response.json({ error: 'This invitation has already been used' }, { status: 410 });
    if (inv.status === 'revoked') return Response.json({ error: 'This invitation has been revoked' }, { status: 403 });
    if (inv.status === 'expired' || (inv.expires_at && new Date(inv.expires_at) < new Date())) {
      return Response.json({ error: 'This invitation has expired' }, { status: 410 });
    }

    return Response.json({
      valid: true,
      client_id: inv.client_id,
      client_name: inv.client_name,
      client_code: inv.client_code,
      client_email: inv.client_email,
      client_phone: inv.client_phone,
      workspace_id: inv.workspace_id,
      workspace_name: inv.workspace_name,
      invitation_id: inv.id,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Verification failed' }, { status: 500 });
  }
}

async function safeBody(req) {
  try { return await req.json(); } catch { return {}; }
}