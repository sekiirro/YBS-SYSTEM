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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function logAudit(
  admin: SupabaseClient,
  caller: { id: string; email?: string | null },
  email: string,
  workspaceId: string | null,
  role: string,
  inviteId: string | null,
  action: string,
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
      entity_type: 'platform_invites',
      entity_id: inviteId || null,
      entity_name: email,
      workspace_id: workspaceId || null,
      metadata: { role },
    });
  } catch {
    // Audit logging must never break the invite flow.
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
    return error('server_not_configured', 'The invitation service is not configured.', 500);
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

    // Acting client carries the caller's identity so the guarded
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

    const email = String(payload?.email || '').trim().toLowerCase();
    const role = String(payload?.role || '').trim().toLowerCase();
    const workspaceId = payload?.workspace_id ? String(payload.workspace_id).trim() : null;

    if (!EMAIL_RE.test(email)) return error('validation', 'A valid email address is required.', 400);
    if (role !== 'platform_trainer' && role !== 'platform_owner') {
      return error('validation', 'Invalid role.', 400);
    }
    if (workspaceId && !UUID_RE.test(workspaceId)) {
      return error('validation', 'Invalid workspace id.', 400);
    }

    // 3. Record the trusted ledger row via the existing SECURITY DEFINER RPC.
    //    This is the real enforcement point: only the platform owner, or a
    //    workspace owner of the target workspace, may invite.
    const { data: invite, error: inviteErr } = await acting.rpc('invite_team_member', {
      p_email: email,
      p_role: role,
      p_workspace_id: workspaceId,
    });
    if (inviteErr) {
      const msg = String(inviteErr.message);
      if (msg.includes('permission_denied')) {
        return error('permission_denied', 'You are not allowed to invite members here.', 403);
      }
      if (msg.includes('email_required')) return error('validation', 'A valid email address is required.', 400);
      if (msg.includes('invalid_role')) return error('validation', 'Invalid role.', 400);
      return error('invite_failed', inviteErr.message || 'Could not record the invitation.', 500);
    }

    // 4. External-invite model. The ledger row minted above carries its own
    //    crypto-random token; THAT is the invitation credential. No
    //    auth.users lookup, no GoTrue invite/recovery admin link, and no
    //    Auth user is created at generation time — the invited trainer
    //    becomes a platform user only when they open the link and set their
    //    password (/activate -> signUp -> handle_new_user consumes the row).
    const inviteToken = invite?.token ? String(invite.token) : null;
    if (!inviteToken) {
      return error('invite_failed', 'The invitation could not be secured.', 500);
    }

    const inviteUrl = `${redirectUrl}?token=${encodeURIComponent(inviteToken)}`;

    await logAudit(admin, caller, email, workspaceId, role, invite?.id, 'invite_link_generated:external');

    return json({
      status: 'ok',
      account_state: 'external',
      invite_url: inviteUrl,
      email,
      role,
      workspace_id: workspaceId,
      invite_id: invite?.id ?? null,
      message:
        'Invitation link generated — no email is sent. Share this link directly with the invited trainer; opening it takes them to set their password.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error('internal_error', msg || 'Unexpected error.', 500);
  }
});