import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { useParams } from 'react-router-dom';
import ClientSignup from '@/pages/ClientSignup';
import AuthLayout from '@/components/AuthLayout';
import { Link } from 'react-router-dom';
import { Building2, Loader2, AlertTriangle } from 'lucide-react';

// Public workspace-specific trainee registration page.
// Resolves a token to ONE workspace via the trusted
// resolve_registration_link (?token) RPC — or, for legacy single
// workspace /join/:token links, falls back to resolve_workspace_join.
// The resolved context includes the workspace + coach + chosen package,
// all derived from the trusted registration-link configuration on the
// server. The trainee never submits workspace/coach/package values, and
// the client code never passes them to signup beyond the token itself.
export default function JoinWorkspace() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({
    status: 'loading', // loading | ready | inactive | invalid | error
    workspace: null,
  });

  useEffect(() => {
    let active = true;
    async function resolve() {
      if (!token) {
        if (active) setState({ status: 'invalid', workspace: null });
        return;
      }

      try {
        // Preferred path: a package-scoped client registration link
        // (workspace_registration_links). Returns rich onboarding context.
        const { data: linkData, error: linkErr } = await supabase.rpc('resolve_registration_link', {
          p_token: token,
        });

        if (!linkErr && linkData?.valid) {
          if (!active) return;
          if (linkData.active === false) {
            setState({ status: 'inactive', workspace: linkData });
            return;
          }
          if (linkData.registration_enabled === false) {
            setState({ status: 'inactive', workspace: linkData });
            return;
          }
          setState({ status: 'ready', workspace: linkData });
          return;
        }

        // Legacy path: single workspace join token (workspace only,
        // no package scoping).
        const { data, error } = await supabase.rpc('resolve_workspace_join', {
          p_token: token,
        });
        if (error) throw error;

        if (!active) return;

        if (!data || !data.valid || !data.workspace_id) {
          setState({ status: 'invalid', workspace: null });
          return;
        }
        if (data.active === false) {
          setState({ status: 'inactive', workspace: data });
          return;
        }
        if (data.registration_enabled === false) {
          setState({ status: 'inactive', workspace: data });
          return;
        }
        setState({ status: 'ready', workspace: data });
      } catch (err) {
        console.error('Error resolving registration link:', err);
        if (active) setState({ status: 'error', workspace: null });
      } finally {
        if (active) setLoading(false);
      }
    }
    resolve();
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) {
    return (
      <AuthLayout brand>
        <div className="flex flex-col items-center text-center py-10">
          <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground mt-3">Resolving registration link…</p>
        </div>
      </AuthLayout>
    );
  }

  if (state.status === 'invalid' || state.status === 'error') {
    return (
      <AuthLayout brand title="Invalid Registration Link">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>
          <p className="text-[14px] text-muted-foreground max-w-sm">
            This registration link is invalid or no longer active. Please contact the brand owner for a new link.
          </p>
          <Link to="/login" className="mt-6 text-[12px] text-primary font-medium hover:underline">
            Go to Sign In
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (state.status === 'inactive') {
    return (
      <AuthLayout brand title="Registration Currently Closed">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-14 h-14 rounded-2xl bg-warning/10 border border-warning/20 flex items-center justify-center mb-4">
            <Building2 className="w-7 h-7 text-warning" />
          </div>
          <p className="text-[14px] text-muted-foreground max-w-sm">
            {state.workspace?.workspace_name || 'This workspace'} is not currently accepting new registrations. Please try again later.
          </p>
          <Link to="/login" className="mt-6 text-[12px] text-primary font-medium hover:underline">
            Go to Sign In
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return <ClientSignup workspace={state.workspace} joinToken={token} />;
}