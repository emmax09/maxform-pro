export type NotificationKind =
  | "form_submission"
  | "payment_received"
  | "event_registration"
  | "email_delivery_issue";

export type WorkspaceNotification = {
  actionUrl: string;
  createdAt: string;
  id: string;
  kind: NotificationKind;
  message: string;
  metadata: Record<string, unknown>;
  priority: "info" | "success" | "warning";
  readAt: string | null;
  title: string;
};

export type WorkspaceNotificationList = {
  notifications: WorkspaceNotification[];
  unreadCount: number;
};

const storedToken = () => localStorage.getItem("access_token") || "";

const request = async <T>(
  action: string,
  input: { body?: Record<string, unknown> } = {},
) => {
  const token = storedToken();
  if (!token) throw new Error("Sign in again to view notifications.");
  const response = await fetch(
    `/api/notifications/data?action=${encodeURIComponent(action)}`,
    {
      method: input.body ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Notifications are temporarily unavailable.");
  }
  return result;
};

export const listWorkspaceNotifications = () =>
  request<WorkspaceNotificationList>("list");

export const markWorkspaceNotificationRead = (id: string) =>
  request<{ notification: { id: string; readAt: string } }>("read", {
    body: { id },
  });

export const markAllWorkspaceNotificationsRead = () =>
  request<{ updated: number }>("read-all", { body: {} });

export const clearWorkspaceNotifications = () =>
  request<{ cleared: number }>("clear-all", { body: {} });
