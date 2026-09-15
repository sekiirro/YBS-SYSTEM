import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/utils/supabase';

const AuthContext = createContext(null);

// For cross-tab auth events: a session is "redundant" for this tab when the
// incoming session is token-identical to the one this tab already holds.
const isSameSession = (a, b) =>
  !!a && !!b && a.access_token === b.access_token && a.expires_at === b.expires_at;

// Events that are fired on cross-tab sync (BroadcastChannel/storage) even when
// nothing meaningful changed for this tab. These must be idempotent.
const REDUNDANT_SESSION_EVENTS = ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'];

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Mirrors the latest `session` state so the auth callback (captured once on
  // mount) can compare without stale-closure reads of the state variable.
  const sessionRef = useRef(null);
  // True only while THIS tab performs its own intentional sign-out.
  const localSignOutRef = useRef(false);

  // Fetch full user profile, roles, memberships, and client link from Supabase
  const loadUserProfile = useCallback(async (authSession) => {
    if (!authSession?.user) {
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      return null;
    }

    try {
      const authUser = authSession.user;
      const userId = authUser.id;

      // 1. Fetch profile record
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.warn('Profile fetch warning:', profileError.message);
      }

      // 2. Fetch workspace memberships
      const { data: memberships } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, workspace_role, status, permissions')
        .eq('user_id', userId)
        .eq('status', 'active');

      const memList = memberships || [];
      const managedWsIds = memList
        .filter((m) => m.workspace_role === 'workspace_owner')
        .map((m) => m.workspace_id);
      const allWsIds = memList.map((m) => m.workspace_id);

      // 3. Check if user is a client
      const { data: clientRecord } = await supabase
        .from('clients')
        .select('id, client_code, workspace_id, status, subscription_status')
        .eq('user_id', userId)
        .maybeSingle();

      const activeWsId =
        profile?.active_workspace_id || managedWsIds[0] || allWsIds[0] || clientRecord?.workspace_id || null;
      const activeMembership = memList.find((m) => m.workspace_id === activeWsId) || memList[0];

      // Consolidated trusted user object
      const fullUser = {
        id: userId,
        email: authUser.email,
        phone: profile?.phone || authUser.phone || authUser.user_metadata?.phone || '',
        full_name: profile?.full_name || authUser.user_metadata?.full_name || authUser.email,
        avatar_url: profile?.avatar_url || authUser.user_metadata?.avatar_url || null,
        platform_role: profile?.platform_role || 'none',
        account_status: profile?.account_status || (authUser.user_metadata?.account_status || 'pending_approval'),
        active_workspace_id: activeWsId,
        permissions: activeMembership?.permissions || [],
        workspace_ids: allWsIds,
        managed_workspace_ids: managedWsIds,
        self_client_id: clientRecord?.id || null,
        client_code: clientRecord?.client_code || null,
        client_subscription_status: clientRecord?.subscription_status || null,
      };

      setUser(fullUser);
      setIsAuthenticated(true);
      setAuthError(null);
      return fullUser;
    } catch (err) {
      console.error('Error constructing user profile:', err);
      setAuthError(err.message);
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  // Initialize and listen to Supabase auth state changes
  useEffect(() => {
    let mounted = true;

    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session: initSession }, error }) => {
      if (!mounted) return;
      if (error) {
        console.error('getSession error:', error);
        setIsLoadingAuth(false);
        return;
      }
      sessionRef.current = initSession;
      setSession(initSession);
      if (initSession) {
        loadUserProfile(initSession);
      } else {
        setIsLoadingAuth(false);
      }
    });

    // Listen for sign-in, sign-out, token refresh.
    //
    // Cross-tab auth is synchronized by @supabase/auth-js over
    // BroadcastChannel + storage events, so this callback can fire for events
    // originating in OTHER tabs. It must stay idempotent:
    //   - redundant TOKEN_REFRESHED / SIGNED_IN / INITIAL_SESSION that carry a
    //     token-identical session must not re-run profile/profile queries
    //   - a cross-tab SIGNED_OUT must not tear down a still-valid local session
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      // Cross-tab sign-out: only this tab's OWN logout may clear auth state.
      // For an ambient SIGNED_OUT, revalidate the shared session instead.
      if (event === 'SIGNED_OUT' && !localSignOutRef.current) {
        const { data: { session: revalidated }, error: revalidatedError } =
          await supabase.auth.getSession();
        if (!mounted) return;
        if (!revalidatedError && revalidated) {
          const same = isSameSession(revalidated, sessionRef.current);
          if (same) return; // session still valid here - keep everything
          sessionRef.current = revalidated;
          setSession(revalidated);
          await loadUserProfile(revalidated);
          return;
        }
        if (revalidatedError) {
          console.error('Cross-tab SIGNED_OUT revalidation error:', revalidatedError.message);
        }
        // Session is actually gone or unreadable - fall through and clear
        // auth state normally (matches the existing getSession error handling).
      }

      // Redundant cross-tab sync for an unchanged session: skip all churn.
      if (REDUNDANT_SESSION_EVENTS.includes(event) && isSameSession(newSession, sessionRef.current)) {
        return;
      }

      sessionRef.current = newSession;
      setSession(newSession);
      if (newSession) {
        await loadUserProfile(newSession);
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadUserProfile]);

  const refreshProfile = useCallback(async () => {
    if (session) {
      return await loadUserProfile(session);
    }
    return null;
  }, [session, loadUserProfile]);

  /**
   * Switches the caller's ACTIVE workspace (the one RLS data access is
   * scoped to for trainer/sales/client membership roles). Persists to
   * profiles.active_workspace_id, then reloads the trusted user object.
   */
  const switchActiveWorkspace = useCallback(async (workspaceId) => {
    if (!session?.user?.id || !workspaceId) return null;
    const { error } = await supabase
      .from('profiles')
      .update({ active_workspace_id: workspaceId, updated_at: new Date().toISOString() })
      .eq('id', session.user.id);
    if (error) throw error;
    return await refreshProfile();
  }, [session, refreshProfile]);

  const logout = useCallback(async (redirectPath = '/login') => {
    // Mark this tab's own intentional sign-out so the SIGNED_OUT handler that
    // follows preserves the existing logout behavior (vs cross-tab sign-outs).
    localSignOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      sessionRef.current = null;
      setUser(null);
      setSession(null);
      setIsAuthenticated(false);
      localSignOutRef.current = false;
      if (redirectPath) {
        window.location.href = redirectPath;
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isAuthenticated,
        isLoadingAuth,
        authError,
        logout,
        refreshProfile,
        switchActiveWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
