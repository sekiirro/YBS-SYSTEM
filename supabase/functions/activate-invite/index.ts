import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// activate-invite
//
// Server-side Workspace Owner / Trainer invitation activation.
// The browser sends ONLY { token, password, first_name, last_name }; the
// email, role and workspace are read exclusively from the trusted
// platform_invites ledger row that the token resolves to. The invitation
// token is the authorization credential — the typed/displayed email is never
// used as identity authority.
//
// first_name / last_name are required for a valid invitation (onboarding
// collects them): they are trimmed here and persisted as
// first_name, last_name and full_name = "<first> <last>" on the profile, for
// both a fresh account and an existing one.
//
// It is deliberately deployed with verify_jwt=false: the invitee has no
// session yet. The token + password pair is its own credential. The
// service-role key stays server-side and is never exposed to the browser.
//
// Existing account vs new account:
//   * New account   -> admin.auth.admin.createUser(...) fires the existing
//                      handle_new_user() trigger (profile + invite
//                      'accepted') and the profile-insert owner-linking
//                      trigger (workspace_owner membership + owner_id).
//   * Existing user -> admin.auth.admin.updateUserById(...) rotates the
//                      password via GoTrue's admin API (never client
//                      signUp), then the same provisioning is applied
//                      server-side for that existing user.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, x-supabase-api-version, content-type',
};

const MIN_PASSWORD_LENGTH = 8;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ExistingUserRow {
  id: string;
  raw_app_meta_data: Record<string, unknown> | null;
}

// Server-side email -> auth.users.id resolution. Granted to service_role
// only, so the browser can never call it.
async function resolveExistingUser(
  admin: SupabaseClient,
  email: string,
): Promise<{ data: ExistingUserRow | null; error: Error | null }> {
  const { data, error: rpcErr } = await admin.rpc('resolve_auth_user_for_invite', {
    p_email: email,
  });
  if (rpcErr) return { data: null, error: rpcErr };
  if (!Array.isArray(data) || data.length === 0) return { data: null, error: null };
  const row = data[0];
  if (!isPlainObject(row) || typeof row.id !== 'string') return { data: null, error: null };
  return {
    data: {
      id: row.id,
      raw_app_meta_data: isPlainObject(row.raw_app_meta_data) ? row.raw_app_meta_data : null,
    },
    error: null,
  };
}

// Ensures the profile row exists with the invited platform role and active
// status (mirrors the profile part of handle_new_user()). The existing
// trigger_sync_brand_owner_on_profile fires on this insert/email update and
// provisions the workspace_owner membership + owner_id for all workspaces
// whose owner_email matches — the invited workspace is always among them
// because owner invites are minted only for the workspace owner_email.
// A platform_owner is never demoted by a non-owner invite.
async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  email: string,
  invitedRole: string,
  firstName: string,
  lastName: string,
) {
  const { data: profile } = await admin
    .from('profiles')
    .select('platform_role')
    .eq('id', userId)
    .maybeSingle();

  const keptRole =
    profile?.platform_role === 'platform_owner' || invitedRole === 'platform_owner'
      ? 'platform_owner'
      : invitedRole;

  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      platform_role: keptRole,
      account_status: 'active',
    },
    { onConflict: 'id' },
  );
  if (profileErr) throw profileErr;
}

// Mirrors provision_invited_trainer_membership(): exactly one ACTIVE
// 'trainer' membership for the invited workspace, applied for an account
// that already existed (the trigger only fires on auth.users INSERT).
async function ensureTrainerMembership(
  admin: SupabaseClient,
  userId: string,
  workspaceId: string | null,
) {
  if (!workspaceId) return;
  const { error: membershipErr } = await admin.from('workspace_memberships').upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      workspace_role: 'trainer',
      status: 'active',
      permissions: [],
    },
    { onConflict: 'workspace_id,user_id' },
  );
  if (membershipErr) throw membershipErr;
}

// Flips the invitation to 'accepted' (same ledger transition handle_new_user
// performs for new accounts). Scoped by token + 'sent', so a replayed token
// can never re-accept an already-consumed invitation.
async function acceptInviteForToken(admin: SupabaseClient, inviteId: string) {
  const { error: acceptErr } = await admin
    .from('platform_invites')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('status', 'sent');
  if (acceptErr) throw acceptErr;
}

// Existing-account path: rotate/confirm the password via the Auth Admin API,
// then provision the profile + membership and consume the invitation.
async function activateExistingUser(
  admin: SupabaseClient,
  existing: ExistingUserRow,
  email: string,
  invitedRole: string,
  workspaceId: string | null,
  password: string,
  inviteId: string,
  firstName: string,
  lastName: string,
) {
  const appMeta = isPlainObject(existing.raw_app_meta_data)
    ? { ...existing.raw_app_meta_data, activated: true }
    : { activated: true };

  const { error: updateErr } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: appMeta,
  });
  if (updateErr) throw updateErr;

  await ensureProfile(admin, existing.id, email, invitedRole, firstName, lastName);
  if (invitedRole === 'platform_trainer') {
    await ensureTrainerMembership(admin, existing.id, workspaceId);
  }
  await acceptInviteForToken(admin, inviteId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return error('method_not_allowed', 'POST requests only.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return error('server_not_configured', 'The activation service is not configured.', 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('bad_request', 'Invalid request body.', 400);
  }
  if (!isPlainObject(body)) {
    return error('bad_request', 'Invalid request body.', 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!token) {
    return error('missing_token', 'This activation link is missing its invitation code.', 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return error('weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  }

  // Onboarding requires a real First Name + Last Name (trimmed server-side;
  // whitespace-only is rejected, so a bypassed form cannot save an email-only
  // member). Length-capped to match the update RPC.
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : '';
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : '';
  if (!firstName || !lastName) {
    return error('name_required', 'Please enter your first and last name.', 400);
  }
  if (firstName.length > 80 || lastName.length > 80) {
    return error('name_too_long', 'Name is too long.', 400);
  }

  try {
    // 1. Validate the invitation credential against the ledger — the same
    //    token match + status='sent' semantics as get_team_invite(), read
    //    server-side directly by the service-role client (RLS-bypassing).
    //    Email/role/workspace come ONLY from this row, never from the request.
    const { data: invite, error: ledgerErr } = await admin
      .from('platform_invites')
      .select('id, email, role, workspace_id, status')
      .eq('token', token)
      .maybeSingle();
    if (ledgerErr) {
      return error('invite_unavailable', 'This invitation could not be verified. Please try again.', 500);
    }
    if (!invite) {
      return error('invite_invalid', 'This invitation link is invalid.', 400);
    }
    if (invite.status !== 'sent') {
      return error('invite_used', 'This invitation has already been used.', 400);
    }

    const email = typeof invite.email === 'string' ? invite.email.trim().toLowerCase() : '';
    const invitedRole = typeof invite.role === 'string' ? invite.role : '';
    const workspaceId = typeof invite.workspace_id === 'string' ? invite.workspace_id : null;
    if (!email || !invitedRole) {
      return error('invite_invalid', 'This invitation is missing required details.', 400);
    }

    // 2. Resolve the invited email against auth.users (server-side only).
    const { data: existing, error: resolveErr } = await resolveExistingUser(admin, email);
    if (resolveErr) {
      return error('auth_unavailable', 'Account activation is temporarily unavailable. Please try again.', 500);
    }

    if (existing) {
      // 3a. Account already exists (partial activation, signup, or client).
      //     Rotate its password via the Auth Admin API — never client-side
      //     signUp — and provision the invited role for THIS user.
      await activateExistingUser(admin, existing, email, invitedRole, workspaceId, password, invite.id, firstName, lastName);
    } else {
      // 3b. No account yet. Create it confirmed + password set via the Auth
      //     Admin API; the existing handle_new_user() trigger provisions the
      //     profile (full_name from user_metadata), flips the invite to
      //     'accepted', and the profile-insert owner-linking trigger
      //     provisions the workspace_owner membership. ensureProfile below
      //     persists first_name / last_name for the new account.
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `${firstName} ${lastName}` },
        app_metadata: { activated: true },
      });
      if (createErr) {
        const msg = String(createErr.message || '');
        if (/already registered|already been registered|user already/i.test(msg)) {
          // Rare concurrent-create race: recover through the existing-user path.
          const retry = await resolveExistingUser(admin, email);
          if (retry.error) {
            return error('auth_unavailable', 'Account activation is temporarily unavailable. Please try again.', 500);
          }
          if (retry.data) {
            await activateExistingUser(admin, retry.data, email, invitedRole, workspaceId, password, invite.id, firstName, lastName);
          } else {
            return error('activation_failed', 'Your account could not be activated. Please try again.', 500);
          }
        } else {
          return error('activation_failed', 'Your account could not be activated. Please try again.', 500);
        }
      } else if (created?.user?.id) {
        await ensureProfile(admin, created.user.id, email, invitedRole, firstName, lastName);
      }
    }

    return json({ status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('activate-invite failed:', msg);
    return error('activation_failed', 'Your account could not be activated. Please try again.', 500);
  }
});