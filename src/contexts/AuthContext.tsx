import React, { createContext, useContext, useEffect, useState } from "react";
import * as authService from "@/lib/auth";
import { clearServerStateScope } from "@/lib/performance/indexed-cache";

type User = authService.User;
type Workspace = authService.WorkspaceSession;

/**
 * What an account that predates workspace membership looks like: its own
 * workspace, unrestricted. Used until the session call answers, and if the
 * server is running an older build that does not send the field.
 */
const ownWorkspace = (user: User | null): Workspace => ({
  id: user?.id || "",
  name: "Workspace",
  ownerEmail: user?.email || "",
  role: "owner",
  isOwner: true,
  canManageWorkspace: true,
  allowedModules: null,
  mustChangePassword: false,
  suspended: false,
});

type Profile = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  company?: string | null;
  phone: string | null;
  country: string | null;
  bio?: string | null;
  role?: string;
  created_at: string;
  updated_at: string;
};

interface AuthContextType {
  user: User | null;
  session: { access_token: string; refresh_token: string } | null;
  profile: Profile | null;
  /** The workspace this session acts in, and the modules it may open. */
  workspace: Workspace;
  loading: boolean;
  signUp: (data: authService.SignUpData) => Promise<void>;
  /** `identifier` is an email address or a username. */
  signIn: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: (intent: "signin" | "signup") => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ token: string; email: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const authAccountCacheKey = "maxform:auth-account";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type CachedAuthAccount = {
  profile: Profile | null;
  user: User;
  workspace?: Workspace;
};

const readTokenUser = (token: string): User | null => {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const payload = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { email?: unknown; exp?: unknown; userId?: unknown };
    const userId = String(payload.userId || "");
    const expiration = Number(payload.exp || 0);
    if (
      !/^[0-9a-f-]{36}$/i.test(userId) ||
      !Number.isFinite(expiration) ||
      expiration * 1_000 <= Date.now()
    ) {
      return null;
    }
    return {
      id: userId,
      email: String(payload.email || ""),
      full_name: "",
      created_at: new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
};

const readCachedAuthAccount = (userId: string): CachedAuthAccount | null => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(authAccountCacheKey) || "null",
    ) as CachedAuthAccount | null;
    return parsed?.user?.id === userId ? parsed : null;
  } catch {
    return null;
  }
};

const writeCachedAuthAccount = (account: CachedAuthAccount) => {
  try {
    localStorage.setItem(authAccountCacheKey, JSON.stringify(account));
  } catch {
    // Authentication continues normally if browser storage is unavailable.
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<{ access_token: string; refresh_token: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Loads the account, its profile, and — the part that matters for access —
   * the workspace grant the rail is built from. Returns whether it succeeded,
   * because the sign-in paths must not hand control to the dashboard until the
   * grant is known: the fallback is an unrestricted workspace, so a silent
   * failure here would show a scoped member every tab in the product.
   */
  const fetchProfile = async (userId: string, token?: string) => {
    try {
      const account = await authService.getSession(token);
      if (account.user.id !== userId) {
        setProfile(null);
        return false;
      }
      const nextProfile = account.profile
        ? { ...account.profile, role: account.role || "user" }
        : null;
      const nextWorkspace = account.workspace || ownWorkspace(account.user);
      setUser(account.user);
      setProfile(nextProfile);
      setWorkspace(nextWorkspace);
      writeCachedAuthAccount({
        profile: nextProfile,
        user: account.user,
        workspace: nextWorkspace,
      });
    } catch {
      setProfile(null);
      return false;
    }
    return true;
  };

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedToken = localStorage.getItem('access_token');
        const storedRefreshToken = localStorage.getItem('refresh_token');
        
        if (storedToken) {
          const tokenUser = readTokenUser(storedToken);
          if (tokenUser) {
            const cachedAccount = readCachedAuthAccount(tokenUser.id);
            setUser(cachedAccount?.user || tokenUser);
            setProfile(cachedAccount?.profile || null);
            // The cached grant keeps the rail stable through a reload. The
            // session call below is what it is finally trusted from.
            setWorkspace(cachedAccount?.workspace || null);
            setSession({
              access_token: storedToken,
              refresh_token: storedRefreshToken || '',
            });
            setLoading(false);
          }
          try {
            const account = await authService.getSession(storedToken);
            const nextProfile = account.profile
              ? { ...account.profile, role: account.role || "user" }
              : null;
            const nextWorkspace = account.workspace || ownWorkspace(account.user);
            setUser(account.user);
            setProfile(nextProfile);
            setWorkspace(nextWorkspace);
            setSession({
              access_token: storedToken,
              refresh_token: storedRefreshToken || ''
            });
            writeCachedAuthAccount({
              profile: nextProfile,
              user: account.user,
              workspace: nextWorkspace,
            });
          } catch {
            setUser(null);
            setSession(null);
            setProfile(null);
            setWorkspace(null);
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem(authAccountCacheKey);
          }
        }
      } catch {
        setUser(null);
        setSession(null);
        setProfile(null);
        setWorkspace(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const signUp = async (data: authService.SignUpData) => {
    try {
      await clearServerStateScope("payments");
      const sessionData = await authService.signUp(data);

      // Tokens first, then the session, and only then `user`.
      //
      // Setting `user` is what lets the sign-in page's route guard redirect to
      // the dashboard, and that redirect tears down the page mid-request --
      // aborting the session call this needs. Losing it leaves the workspace
      // grant unset, and its fallback is "unrestricted", so a scoped member
      // would see every tab in the rail until they happened to hard-refresh.
      localStorage.setItem('access_token', sessionData.access_token);
      localStorage.setItem('refresh_token', sessionData.refresh_token);
      setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      const loaded = await fetchProfile(
        sessionData.user.id,
        sessionData.access_token,
      );
      // fetchProfile sets `user` itself when it succeeds. This covers the case
      // where the session call could not be reached at all, so sign-in still
      // completes rather than stranding someone on the form.
      if (!loaded) {
        setUser(sessionData.user);
        writeCachedAuthAccount({ profile: null, user: sessionData.user });
      }
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Sign up failed'));
    }
  };

  const signIn = async (identifier: string, password: string) => {
    try {
      await clearServerStateScope("payments");
      const sessionData = await authService.signIn(identifier, password);

      // Tokens first, then the session, and only then `user`.
      //
      // Setting `user` is what lets the sign-in page's route guard redirect to
      // the dashboard, and that redirect tears down the page mid-request --
      // aborting the session call this needs. Losing it leaves the workspace
      // grant unset, and its fallback is "unrestricted", so a scoped member
      // would see every tab in the rail until they happened to hard-refresh.
      localStorage.setItem('access_token', sessionData.access_token);
      localStorage.setItem('refresh_token', sessionData.refresh_token);
      setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      const loaded = await fetchProfile(
        sessionData.user.id,
        sessionData.access_token,
      );
      // fetchProfile sets `user` itself when it succeeds. This covers the case
      // where the session call could not be reached at all, so sign-in still
      // completes rather than stranding someone on the form.
      if (!loaded) {
        setUser(sessionData.user);
        writeCachedAuthAccount({ profile: null, user: sessionData.user });
      }
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Sign in failed'));
    }
  };

  const signInWithGoogle = async (intent: "signin" | "signup") => {
    try {
      await clearServerStateScope("payments");
      const sessionData = await authService.signInWithGoogle(intent);

      // Tokens first, then the session, and only then `user`.
      //
      // Setting `user` is what lets the sign-in page's route guard redirect to
      // the dashboard, and that redirect tears down the page mid-request --
      // aborting the session call this needs. Losing it leaves the workspace
      // grant unset, and its fallback is "unrestricted", so a scoped member
      // would see every tab in the rail until they happened to hard-refresh.
      localStorage.setItem('access_token', sessionData.access_token);
      localStorage.setItem('refresh_token', sessionData.refresh_token);
      setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      const loaded = await fetchProfile(
        sessionData.user.id,
        sessionData.access_token,
      );
      // fetchProfile sets `user` itself when it succeeds. This covers the case
      // where the session call could not be reached at all, so sign-in still
      // completes rather than stranding someone on the form.
      if (!loaded) {
        setUser(sessionData.user);
        writeCachedAuthAccount({ profile: null, user: sessionData.user });
      }
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, "Google sign in failed"));
    }
  };

  const signOut = async () => {
    setUser(null);
    setSession(null);
    setProfile(null);
    setWorkspace(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem(authAccountCacheKey);
    await clearServerStateScope("payments");
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const requestPasswordReset = async (email: string) => {
    try {
      return await authService.requestPasswordReset(email);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Password reset request failed'));
    }
  };

  const resetPassword = async (token: string, newPassword: string) => {
    try {
      await authService.resetPassword(token, newPassword);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Password reset failed'));
    }
  };

  const updatePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) throw new Error('No user logged in');
    try {
      await authService.updatePassword(user.id, currentPassword, newPassword);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Password update failed'));
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      workspace: workspace || ownWorkspace(user),
      loading,
      signUp, 
      signIn, 
      signInWithGoogle,
      signOut, 
      refreshProfile,
      requestPasswordReset,
      resetPassword,
      updatePassword
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// This hook intentionally shares the provider module.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
