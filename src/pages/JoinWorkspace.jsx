import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { useParams } from 'react-router-dom';
import ClientSignup from '@/pages/ClientSignup';
import AuthLayout from '@/components/AuthLayout';
import { Link } from 'react-router-dom';
import { Building2, Loader2, AlertTriangle } from 'lucide-react';

// Public workspace-specific trainee registration page.
// Resolves the join token to exactly one workspace via the trusted
// resolve_workspace_join RPC, then delegates the form to ClientSignup
// with the validated context. The trainee never picks a brand or
// workspace, and the client code never submits a workspace_id.
export default function JoinWorkspace() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({
    status: 'loading', // loading | ready | invalid | inactive | error
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