import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { useParams, Link } from 'react-router-dom';
import ClientSignup from '@/pages/ClientSignup';
import { AuthStatusCard } from '@/components/auth/AuthShell';
import { LoadingState } from '@/components/ui';
import { Building2, AlertTriangle, KeyRound } from 'lucide-react';

// Public workspace-specific trainee registration page. All workspace and
// package context comes from trusted resolver RPCs; the browser only retains
// the opaque registration token. Every state renders inside the shared YBS
// authentication experience — only validated invitations reach the form.
export default function JoinWorkspace() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({ status: 'loading', workspace: null });

  useEffect(() => {
    let active = true;
    async function resolve() {
      if (!token) {
        if (active) setState({ status: 'invalid', workspace: null });
        if (active) setLoading(false);
        return;
      }
      try {
        const { data: linkData, error: linkErr } = await supabase.rpc('resolve_registration_link', { p_token: token });
        if (!linkErr && linkData?.valid) {
          if (!active) return;
          if (linkData.active === false || linkData.registration_enabled === false) {
            setState({ status: 'inactive', workspace: linkData });
          } else {
            setState({ status: 'ready', workspace: linkData });
          }
          return;
        }

        const { data, error } = await supabase.rpc('resolve_workspace_join', { p_token: token });
        if (error) throw error;
        if (!active) return;
        if (!data?.valid || !data.workspace_id) {
          setState({ status: 'invalid', workspace: null });
        } else if (data.active === false || data.registration_enabled === false) {
          setState({ status: 'inactive', workspace: data });
        } else {
          setState({ status: 'ready', workspace: data });
        }
      } catch (err) {
        console.error('Error resolving registration link:', err);
        if (active) setState({ status: 'error', workspace: null });
      } finally {
        if (active) setLoading(false);
      }
    }
    resolve();
    return () => { active = false; };
  }, [token]);

  if (loading) {
    return <LoadingState label="Opening your workspace" />;
  }

  if (state.status === 'invalid' || state.status === 'error') {
    return (
      <AuthStatusCard
        icon={AlertTriangle}
        eyebrow="Link unavailable"
        title="This invitation link is invalid."
        description="Ask the workspace owner for a new registration link. No account information has been submitted."
        action={<Link to="/login" className="registration-primary-action">Go to Login</Link>}
      />
    );
  }

  if (state.status === 'inactive') {
    return (
      <AuthStatusCard
        icon={Building2}
        eyebrow="Registration paused"
        title="This invitation has expired."
        description={`${state.workspace?.workspace_name || 'This workspace'} is not accepting new registrations right now. Please check back later.`}
        action={<Link to="/login" className="registration-primary-action">Go to Login</Link>}
      />
    );
  }

  if (state.status !== 'ready') {
    return (
      <AuthStatusCard
        icon={KeyRound}
        eyebrow="Link unavailable"
        title="This invitation link is invalid."
        description="Ask the workspace owner for a new registration link."
        action={<Link to="/login" className="registration-primary-action">Go to Login</Link>}
      />
    );
  }

  return <ClientSignup workspace={state.workspace} joinToken={token} />;
}
