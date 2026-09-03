import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { resolveUserByIdentifier } from '../../shared/auth.ts';

// Resolves a phone number (or email) to the user's email so the client can
// authenticate via the platform's email/password auth. Does not verify the password.
export default async function(req) {
  try {
    const body = await req.json();
    const identifier = body && body.identifier;
    if (!identifier) return Response.json({ error: 'Identifier required' }, { status: 400 });

    const base44 = createClientFromRequest(req);
    const user = await resolveUserByIdentifier(base44, identifier);
    if (!user) {
      // Generic error — do not confirm whether the identifier exists.
      return Response.json({ error: 'No account found for this phone number' }, { status: 404 });
    }
    if (user.data && user.data.account_status && user.data.account_status !== 'active' && user.role !== 'admin') {
      return Response.json({ error: 'Account is not active', account_status: user.data.account_status }, { status: 403 });
    }
    return Response.json({ email: user.email, user_id: user.id });
  } catch (error) {
    return Response.json({ error: error.message || 'Resolution failed' }, { status: 500 });
  }
}