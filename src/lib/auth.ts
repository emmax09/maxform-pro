export interface User {
  id: string;
  email: string;
  username?: string;
  full_name: string;
  phone?: string;
  short_id?: string;
  created_at: string;
}

export type WorkspaceMemberRole = "owner" | "admin" | "moderator" | "user";

/**
 * Which workspace this session acts in and what it may open. An owner is
 * unrestricted (`allowedModules: null`); a member added from Settings gets the
 * modules their owner ticked.
 */
export interface WorkspaceSession {
  id: string;
  name: string;
  ownerEmail: string;
  role: WorkspaceMemberRole;
  isOwner: boolean;
  canManageWorkspace: boolean;
  allowedModules: string[] | null;
  mustChangePassword: boolean;
  /** Membership paused by the owner: the workspace opens to nothing. */
  suspended?: boolean;
}

export interface SignUpData {
  email: string;
  password: string;
  /** The workspace name is the only name collected during account sign-up. */
  workspaceName: string;
  /** Kept optional for older clients; the server falls back to workspaceName. */
  fullName?: string;
  phone?: string;
  country?: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface Profile {
  avatar_url: string | null;
  bio?: string | null;
  company?: string | null;
  country: string | null;
  created_at: string;
  full_name: string;
  id: string;
  job_title: string | null;
  phone: string | null;
  role?: string;
  updated_at: string;
  user_id: string;
}

export interface AuthTokenPayload {
  userId: string;
}

export type AuthSessionResponse = {
  profile: Profile | null;
  role: string;
  user: User;
  workspace?: WorkspaceSession;
};

const storedToken = () => localStorage.getItem("access_token") || "";

const authRequest = async <T>(
  action: string,
  input: {
    body?: object;
    token?: string;
  } = {},
) => {
  const response = await fetch(
    `/api/auth?action=${encodeURIComponent(action)}`,
    {
      method: input.body ? "POST" : "GET",
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(input.token
          ? { Authorization: `Bearer ${input.token}` }
          : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Account services are unavailable.");
  }
  return result;
};

export const signUp = (data: SignUpData) =>
  authRequest<Session>("sign-up", { body: data });

/**
 * `identifier` is an email address or a username — provisioned members are
 * given both and the credentials mail shows both.
 */
export const signIn = (identifier: string, password: string) =>
  authRequest<Session>("sign-in", {
    body: { identifier, email: identifier, password },
  });

export const signInWithGoogle = async (
  intent: "signin" | "signup" = "signin",
): Promise<Session> => {
  const width = 520;
  const height = 680;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(
    "about:blank",
    "maxform-google-auth",
    `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  );
  if (!popup) {
    throw new Error("Allow pop-ups to continue with Google.");
  }

  const configuration = await fetch("/api/auth?action=google-config", {
    headers: { Accept: "application/json" },
  });
  if (!configuration.ok) {
    popup.close();
    const result = (await configuration.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(result.error || "Google authentication is unavailable.");
  }

  popup.location.href = `/api/auth?action=google-start&intent=${intent}`;

  return new Promise<Session>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", receiveMessage);
      window.clearInterval(closedCheck);
      window.clearTimeout(timeout);
      callback();
    };
    const receiveMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        error?: unknown;
        session?: Session;
        type?: unknown;
      };
      if (!data || data.type !== "maxform:google-auth") return;
      if (data.error) {
        finish(() => reject(new Error(String(data.error))));
        return;
      }
      if (
        !data.session?.access_token ||
        !data.session.refresh_token ||
        !data.session.user?.id
      ) {
        finish(() =>
          reject(new Error("Google returned an invalid account session.")),
        );
        return;
      }
      finish(() => resolve(data.session!));
    };
    const closedCheck = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new Error("Google sign-in was cancelled.")));
      }
    }, 500);
    const timeout = window.setTimeout(() => {
      popup.close();
      finish(() =>
        reject(new Error("Google sign-in timed out. Please try again.")),
      );
    }, 2 * 60_000);

    window.addEventListener("message", receiveMessage);
  });
};

export const getSession = (token = storedToken()) =>
  authRequest<AuthSessionResponse>("session", { token });

export const verifyToken = async (
  token: string,
): Promise<AuthTokenPayload> => {
  const result = await getSession(token);
  return { userId: result.user.id };
};

export const getUserById = async (userId: string): Promise<User | null> => {
  const result = await getSession();
  return result.user.id === userId ? result.user : null;
};

export const getProfileByUserId = async (
  userId: string,
): Promise<Profile | null> => {
  const result = await getSession();
  return result.user.id === userId ? result.profile : null;
};

export const getUserRole = async (userId: string): Promise<string | null> => {
  const result = await getSession();
  return result.user.id === userId ? result.role : null;
};

/** `identifier` is an email address or a username; the server accepts either. */
export const requestPasswordReset = (
  identifier: string,
): Promise<{ token: string; email: string }> =>
  authRequest("request-reset", {
    body: { identifier, email: identifier },
  });

export const verifyResetToken = async (token: string): Promise<boolean> => {
  const result = await authRequest<{ valid: boolean }>("verify-reset", {
    body: { token },
  });
  return result.valid;
};

export const resetPassword = (
  token: string,
  newPassword: string,
): Promise<void> =>
  authRequest("reset-password", { body: { newPassword, token } }).then(
    () => undefined,
  );

export const updatePassword = (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  void userId;
  return authRequest("update-password", {
    body: { currentPassword, newPassword },
    token: storedToken(),
  }).then(() => undefined);
};

export const deleteAccount = (currentPassword: string): Promise<void> =>
  authRequest("delete-account", {
    body: { currentPassword },
    token: storedToken(),
  }).then(() => undefined);
