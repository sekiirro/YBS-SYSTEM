import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

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
      setSession(initSession);
      if (initSession) {
        loadUserProfile(initSession);
      } else {
        setIsLoadingAuth(false);
      }
    });

    // Listen for sign-in, sign-out, token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
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

  const logout = useCallback(async (redirectPath = '/login') => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      setUser(null);
      setSession(null);
      setIsAuthenticated(false);
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
