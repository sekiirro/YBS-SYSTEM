import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fixed production landing page. Read from env to allow a local override,
// but NEVER accept a redirect URL supplied by the browser.
const DEFAULT_REDIRECT = 'https://ybs-system.theecaesarr.workers.dev/activate';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, x-supabase-api-version, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function logAudit(
  admin: SupabaseClient,
  caller: { id: string; email?: string | null },
  action: string,
  metadata: { workspace_id: string; workspace_name: string; email: string; role: string },
) {
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('platform_role, full_name')
      .eq('id', caller.id)
      .maybeSingle();

    await admin.from('audit_logs').insert({
      actor_id: caller.id,
      actor_name: profile?.full_name || caller.email || caller.id,
      actor_role: profile?.platform_role || null,
      action,
      entity_type: 'workspaces',
      entity_id: metadata.workspace_id,
      entity_name: metadata.email,
      workspace_id: metadata.workspace_id,
      metadata: { role: metadata.role, workspace_name: metadata.workspace_name },
    });
  } catch {
    // Audit logging must never break the link generation flow.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return error('method_not_allowed', 'POST requests only.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const redirectUrl = Deno.env.get('YBS_ACTIVATE_REDIRECT_URL') || DEFAULT_REDIRECT;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return error('server_not_configured', 'The activation link service is not configured.', 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1. Authenticate the caller from their own access token (no secret client-side).
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return error('unauthorized', 'Missing authorization token.', 401);

    const callerAuth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerErr } = await callerAuth.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return error('unauthorized', 'Invalid authorization token.', 401);
    }
    const caller = callerData.user;

    // The acting client carries the caller's identity so the guarded
    // invite_team_member RPC enforces authorization via auth.uid().
    const acting = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // 2. Validate the payload.
    let payload;
    try {
      payload = await req.json();
    } catch {
      return error('bad_request', 'Invalid JSON body.', 400);
    }
    const workspaceId = payload?.workspace_id ? String(payload.workspace_id).trim() : null;
    if (!workspaceId || !UUID_RE.test(workspaceId)) {
      return error('validation', 'A valid workspace id is required.', 400);
    }

    // 3. Authorize the caller server-side: the platform owner, or an active
    //    owner of the target workspace, may generate its activation link.
    const { data: profile } = await admin
      .from('profiles')
      .select('platform_role')
      .eq('id', caller.id)
      .maybeSingle();
    const isPlatformOwner = profile?.platform_role === 'platform_owner';
    const { data: membership } = await admin
      .from('workspace_memberships')
      .select('workspace_role')
      .eq('user_id', caller.id)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .maybeSingle();
    if (!isPlatformOwner && membership?.workspace_role !== 'workspace_owner') {
      return error('permission_denied', 'You are not allowed to generate an activation link for this workspace.', 403);
    }

    // 4. The owner email always comes from the trusted workspaces row, never
    //    from client input.
    const { data: ws, error: wsErr } = await admin
      .from('workspaces')
      .select('name, owner_email, owner_name')
      .eq('id', workspaceId)
      .maybeSingle();
    if (wsErr || !ws) return error('workspace_not_found', 'Workspace not found.', 404);
    const email = String(ws.owner_email || '').trim().toLowerCase();
    if (!email) return error('validation', 'This workspace has no owner email configured.', 400);

    // 5. External-invite model, identical to generate-trainer-invite: write the
    //    ledger row with its own crypto token via invite_team_member and
    //    return an /activate link. No auth.users lookup, no generateLink, no
    //    user creation at generation time. The workspace owner becomes a
    //    platform user only when they open the link, set their password and
    //    sign up — then handle_new_user + sync_brand_owner_to_workspaces
    //    provision ownership server-side.
    const { data: invite, error: inviteErr } = await acting.rpc('invite_team_member', {
      p_email: email,
      p_role: 'platform_owner',
      p_workspace_id: workspaceId,
    });
    if (inviteErr) {
      const msg = String(inviteErr.message);
      if (msg.includes('permission_denied')) {
        return error('permission_denied', 'You are not allowed to generate an activation link for this workspace.', 403);
      }
      return error('invite_failed', inviteErr.message || 'Could not record the activation invitation.', 500);
    }

    const inviteToken = invite?.token ? String(invite.token) : null;
    if (!inviteToken) {
      return error('invite_failed', 'The activation invitation could not be secured.', 500);
    }

    const inviteUrl = `${redirectUrl}?token=${encodeURIComponent(inviteToken)}`;

    await logAudit(admin, caller, 'owner_activation_link_generated:external', {
      workspace_id: workspaceId,
      workspace_name: ws.name || workspaceId,
      email,
      role: 'workspace_owner',
    });

    return json({
      status: 'ok',
      account_state: 'external',
      invite_url: inviteUrl,
      email,
      workspace_id: workspaceId,
      invite_id: invite?.id ?? null,
      message:
        'Activation link generated — no email is sent. Share this link directly with the workspace owner; opening it takes them to set their password.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error('internal_error', msg || 'Unexpected error.', 500);
  }
});