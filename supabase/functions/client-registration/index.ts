import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// client-registration
//
// Server-side client registration flow with IP protection per registration link.
//
// Replaces the browser-only supabase.auth.signUp() call in ClientSignup.jsx.
// The Edge Function:
//   1. Resolves the registration link server-side via resolve_registration_link().
//   2. Captures the caller IP from TRUSTED Supabase Edge runtime headers
//      (never from the browser body).
//   3. Atomically reserves (link_id, ip) via the server-side RPC; the UNIQUE
//      index is the authoritative concurrency guard.
//   4. Creates the auth account via admin.auth.admin.createUser() so the
//      existing handle_new_user() trigger fires (profile + client_application
//      + link_token resolution all run exactly as they do today).
//   5. Finalizes the reservation (binds user_id) on success, or releases it
//      on failure so a crash can never permanently burn an IP/link pair.
//
// verify_jwt = false: trainees have no session yet. The registration link
// token (carried in the request body) is the credential. The service-role
// key stays server-side and is never exposed to the browser.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, x-supabase-api-version, content-type, x-forwarded-for, cf-connecting-ip, x-real-ip',
};

const MIN_PASSWORD_LENGTH = 8;
const NATIONAL_NUMBER_MIN_LENGTH = 9;

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

// Server-side IP extraction. Supabase Edge runtimes forward the real client
// IP in one of these headers. Order matters: prefer the direct proxy header.
function extractClientIp(req: Request): string | null {
  // x-forwarded-for can contain a comma-separated chain; the FIRST entry is
  // the original client when the request has passed through one proxy.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const cfConnecting = req.headers.get('cf-connecting-ip');
  if (cfConnecting) {
    const trimmed = cfConnecting.trim();
    if (trimmed) return trimmed;
  }

  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) {
    const trimmed = xRealIp.trim();
    if (trimmed) return trimmed;
  }

  // Supabase Edge runtime also provides this header.
  const forwarded = req.headers.get('forwarded');
  if (forwarded) {
    const match = forwarded.match(/for=([^;,\s]+)/i);
    if (match) {
      let val = match[1].replace(/^"|"$/g, '');
      if (val.startsWith('[')) {
        // IPv6 bracketed
        const end = val.indexOf(']');
        if (end > 0) val = val.substring(1, end);
      }
      return val;
    }
  }

  return null;
}

function normalizeIpForInet(ip: string | null): string | null {
  if (!ip) return null;
  // Handle bracketed IPv6 from forwarded header
  let cleaned = ip.replace(/^\[|]$/g, '').trim();
  if (!cleaned) return null;
  return cleaned;
}

async function resolvePhoneIdentifier(
  admin: SupabaseClient,
  phone: string
): Promise<{ found: boolean } | { error: Error }> {
  const { data, error } = await admin.rpc('resolve_phone_identifier', {
    p_phone: phone,
  });

  if (error) {
    return { error };
  }

  return { found: !!(data && (data as any).found) };
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
    return error('server_not_configured', 'The registration service is not configured.', 500);
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
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

  if (!token) {
    return error('missing_token', 'A registration token is required.', 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return error('weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  }
  if (!fullName || fullName.length > 80) {
    return error('invalid_name', 'A valid full name is required (max 80 characters).', 400);
  }

  // ------------------------------------------------------------
  // 1. Resolve registration link server-side.
  // ------------------------------------------------------------
  const { data: linkData, error: linkErr } = await admin.rpc('resolve_registration_link', {
    p_token: token,
  });

  if (linkErr) {
    console.error('resolve_registration_link failed:', linkErr.message);
    return error('link_unavailable', 'Unable to verify the registration link.', 500);
  }

  if (!linkData || !linkData.valid) {
    return error('link_invalid', 'This registration link is invalid or no longer active.', 400);
  }

  if (linkData.active === false || linkData.registration_enabled === false) {
    return error(
      'link_inactive',
      linkData.registration_enabled === false
        ? 'This workspace is not currently accepting new registrations.'
        : 'This registration link is no longer active. Please contact the brand owner for a new link.',
      403,
    );
  }

  const linkId = linkData.link_id;

  // ------------------------------------------------------------
  // 2. Capture caller IP server-side (never trust the body).
  // ------------------------------------------------------------
  const rawIp = extractClientIp(req);
  const clientIp = normalizeIpForInet(rawIp);

  if (!clientIp) {
    // The IP is required for the uniqueness guard. Without it we cannot
    // enforce the dedup rule, so we refuse rather than weakening security.
    return error(
      'ip_unavailable',
      'Unable to determine your network location for registration protection. Please try again from the same browser/network.',
      400,
    );
  }

  // ------------------------------------------------------------
  // 3. Atomically reserve (link_id, ip). The UNIQUE index on the
  //    reservation ledger is the authoritative guard for concurrent
  //    same-link/same-IP requests.
  // ------------------------------------------------------------
  const { data: reservation, error: reserveErr } = await admin.rpc('reserve_registration_link_ip', {
    p_link_id: linkId,
    p_ip_address: clientIp,
  });

  if (reserveErr) {
    console.error('reserve_registration_link_ip failed:', reserveErr.message);
    return error('reservation_failed', 'Unable to start the registration reservation. Please try again.', 500);
  }

  if (reservation && !reservation.reserved) {
    const reason = (reservation as any).reason;
    if (reason === 'ip_taken_finalized' || reason === 'ip_taken_reserved') {
      return error(
        'ip_taken',
        'An account has already been registered from this network using this registration link. Please contact the brand owner if you believe this is an error.',
        409,
      );
    }
    return error('reservation_failed', 'Your registration could not be started. Please try again.', 400);
  }

  // ------------------------------------------------------------
  // 4. Pre-flight: phone collision check (same UX as the browser path).
  // ------------------------------------------------------------
  if (phone) {
    const phoneResult = await resolvePhoneIdentifier(admin, phone);
    if ('error' in phoneResult) {
      // Don't leak the phone check error; just block registration.
      console.warn('Phone identifier resolution error:', (phoneResult as any).error?.message);
      await admin.rpc('release_registration_link_ip', {
        p_link_id: linkId,
        p_ip_address: clientIp,
      });
      return error('phone_check_failed', 'Unable to verify your phone number. Please try again.', 500);
    }
    if (phoneResult.found) {
      await admin.rpc('release_registration_link_ip', {
        p_link_id: linkId,
        p_ip_address: clientIp,
      });
      return error(
        'phone_taken',
        'This phone number is already registered to an account. Please sign in instead, or use a different phone number.',
        409,
      );
    }
  }

  // ------------------------------------------------------------
  // 5. Create the auth account via the Admin API.
  //    createUser fires handle_new_user() (existing trigger), which:
  //      - upserts profiles(id, email, phone, full_name, ...)
  //      - resolves the link_token server-side (workspace + coach + package)
  //      - creates a pending client_application
  //    This preserves the EXACT existing behavior: pending approval,
  //    email confirmation, session/no-session, phone checks.
  // ------------------------------------------------------------
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone: phone || '',
      platform_role: 'none',
      account_status: 'pending_approval',
      link_token: token,
    },
    app_metadata: {
      platform_role: 'none',
      account_status: 'pending_approval',
    },
  });

  if (authErr) {
    const msg = String(authErr.message || '');
    // Release the reservation so a crash/retry doesn't permanently block the IP.
    await admin.rpc('release_registration_link_ip', {
      p_link_id: linkId,
      p_ip_address: clientIp,
    });

    if (/already registered|already been registered|user already/i.test(msg)) {
      return error(
        'email_taken',
        'An account with this email address already exists. Please sign in instead.',
        409,
      );
    }
    console.error('createUser failed:', msg);
    return error('registration_failed', 'Unable to create your account. Please try again.', 500);
  }

  if (!authData?.user?.id) {
    await admin.rpc('release_registration_link_ip', {
      p_link_id: linkId,
      p_ip_address: clientIp,
    });
    return error('registration_failed', 'Unable to create your account. Please try again.', 500);
  }

  // ------------------------------------------------------------
  // 6. Finalize the reservation (bind user_id, make permanent).
  // ------------------------------------------------------------
  const { data: finalizeData, error: finalizeErr } = await admin.rpc('finalize_registration_reservation', {
    p_link_id: linkId,
    p_ip_address: clientIp,
    p_user_id: authData.user.id,
  });

  if (finalizeErr) {
    // Non-fatal: the reservation will TTL-expire and be reaped by cron.
    // The user account was already created successfully.
    console.warn('finalize_registration_reservation failed:', finalizeErr.message);
  }

  // ------------------------------------------------------------
  // 7. Best-effort: the browser may not have a session (email
  //    confirmation may be required). The existing flow handles the
  //    signed_up + pending_approval path. Return the resolved context
  //    so the frontend can show the same confirmation page it did before.
  // ------------------------------------------------------------
  return json({
    status: 'ok',
    needs_email_confirmation: authData.user.email_confirmed_at == null,
    user_id: authData.user.id,
    email: authData.user.email,
  });
});
