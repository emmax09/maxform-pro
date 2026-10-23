import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  CircleDollarSign,
  FileText,
  Inbox,
  MailWarning,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearWorkspaceNotifications,
  listWorkspaceNotifications,
  markAllWorkspaceNotificationsRead,
  markWorkspaceNotificationRead,
  type NotificationKind,
  type WorkspaceNotification,
  type WorkspaceNotificationList,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

const notificationQueryKey = (userId: string) => [
  "notifications",
  "workspace",
  userId,
];

const notificationIcons: Record<NotificationKind, LucideIcon> = {
  email_delivery_issue: MailWarning,
  event_registration: CalendarDays,
  form_submission: FileText,
  payment_received: CircleDollarSign,
};

const relativeTime = (value: string) => {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: new Date(value).getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric",
  }).format(new Date(value));
};

const updateReadNotification = (
  current: WorkspaceNotificationList | undefined,
  notificationId: string,
  readAt: string,
) => {
  if (!current) return current;
  const target = current.notifications.find(
    (notification) => notification.id === notificationId,
  );
  return {
    notifications: current.notifications.map((notification) =>
      notification.id === notificationId
        ? { ...notification, readAt }
        : notification,
    ),
    unreadCount:
      target && !target.readAt
        ? Math.max(0, current.unreadCount - 1)
        : current.unreadCount,
  };
};

export function NotificationCenter({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = notificationQueryKey(userId || "anonymous");
  const notificationsQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: listWorkspaceNotifications,
    queryKey,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const readMutation = useMutation({
    mutationFn: markWorkspaceNotificationRead,
    onSuccess: ({ notification }) => {
      queryClient.setQueryData<WorkspaceNotificationList>(
        queryKey,
        (current) =>
          updateReadNotification(
            current,
            notification.id,
            notification.readAt,
          ),
      );
    },
    onError: () => {
      toast.error("Notification could not be marked as read.");
    },
  });
  const readAllMutation = useMutation({
    mutationFn: markAllWorkspaceNotificationsRead,
    onSuccess: () => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<WorkspaceNotificationList>(
        queryKey,
        (current) =>
          current
            ? {
                notifications: current.notifications.map((notification) => ({
                  ...notification,
                  readAt: notification.readAt || readAt,
                })),
                unreadCount: 0,
              }
            : current,
      );
    },
    onError: () => {
      toast.error("Notifications could not be marked as read.");
    },
  });
  const clearAllMutation = useMutation({
    mutationFn: clearWorkspaceNotifications,
    onSuccess: ({ cleared }) => {
      queryClient.setQueryData<WorkspaceNotificationList>(queryKey, {
        notifications: [],
        unreadCount: 0,
      });
      toast.success(
        cleared === 1
          ? "Notification cleared."
          : `${cleared} notifications cleared.`,
      );
    },
    onError: () => {
      toast.error("Notifications could not be cleared.");
    },
  });

  const data = notificationsQuery.data;
  const unreadCount = data?.unreadCount || 0;
  const hasNotifications = Boolean(data?.notifications.length);

  const openNotification = async (notification: WorkspaceNotification) => {
    if (!notification.readAt) {
      try {
        await readMutation.mutateAsync(notification.id);
      } catch {
        // Navigation remains available if marking the row read is interrupted.
      }
    }
    setOpen(false);
    navigate(notification.actionUrl);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (open && notificationsQuery.isStale) {
          void notificationsQuery.refetch();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label={
            unreadCount
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={12}
        className="w-[min(400px,calc(100vw-24px))] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">
              Notifications
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {unreadCount
                ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                : "You’re up to date"}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button
              type="button"
              onClick={() => readAllMutation.mutate()}
              loading={readAllMutation.isPending}
              loadingLabel="Marking notifications as read"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {notificationsQuery.isLoading ? (
          <div className="space-y-1 p-2" aria-label="Loading notifications">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex gap-3 rounded-md px-2 py-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : notificationsQuery.isError ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <MailWarning className="h-4 w-4" />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-foreground">
              Notifications couldn’t load
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] leading-5 text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => void notificationsQuery.refetch()}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[11px] font-medium text-foreground hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        ) : data?.notifications.length ? (
          <div className="dashboard-scroll max-h-[min(460px,65vh)] overflow-y-auto p-2">
            {data.notifications.map((notification) => {
              const Icon = notificationIcons[notification.kind] || Bell;
              const unread = !notification.readAt;
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void openNotification(notification)}
                  className={cn(
                    "group relative flex w-full gap-3 rounded-md px-2.5 py-3 text-left transition-colors hover:bg-accent",
                    unread && "bg-primary/4.5",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      notification.priority === "success"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : notification.priority === "warning"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span
                        className={cn(
                          "truncate text-[12px] text-foreground",
                          unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {notification.title}
                      </span>
                      {unread && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className="mt-1 line-clamp-2 text-[11px] leading-[1.55] text-muted-foreground">
                      {notification.message}
                    </span>
                    <span className="mt-1.5 block text-[10px] text-muted-foreground/80">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-11 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="h-[18px] w-[18px]" />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-foreground">
              No notifications yet
            </p>
            <p className="mt-1 max-w-[270px] text-[11px] leading-5 text-muted-foreground">
              Real form responses, payments, event registrations, and delivery
              issues will appear here.
            </p>
          </div>
        )}

        <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span>Synced from live workspace activity</span>
          {hasNotifications && (
            <Button
              type="button"
              onClick={() => clearAllMutation.mutate()}
              loading={clearAllMutation.isPending}
              loadingLabel="Clearing notifications"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear all
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
