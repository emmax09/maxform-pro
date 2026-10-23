import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  BrainCircuit,
  CalendarClock,
  ChartLine,
  ClipboardList,
  FileSignature,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Ticket,
  UsersRound,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BrandLogo } from "./BrandLogo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceIdentity } from "@/hooks/use-workspace-logo";

type NavItem = {
  icon: LucideIcon;
  label: string;
  tab: string;
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Home", tab: "home" },
  { icon: ChartLine, label: "Analytics", tab: "analytics" },
  { icon: FolderKanban, label: "Projects", tab: "projects" },
  { icon: UsersRound, label: "CRM", tab: "crm" },
  { icon: Megaphone, label: "Campaigns", tab: "campaigns" },
  { icon: ClipboardList, label: "Forms", tab: "forms" },
  { icon: Workflow, label: "Workflows", tab: "workflows" },
  { icon: FolderOpen, label: "Files", tab: "files" },
  { icon: FileSignature, label: "Documents", tab: "documents" },
  { icon: WalletCards, label: "Payments", tab: "payments" },
  { icon: ShoppingBag, label: "Orders", tab: "orders" },
  { icon: Store, label: "Connected stores", tab: "stores" },
  { icon: Ticket, label: "Events", tab: "events" },
  { icon: CalendarClock, label: "Appointments", tab: "appointments" },
  { icon: BrainCircuit, label: "MaxAI", tab: "ai" },
  { icon: AtSign, label: "Email settings", tab: "emails" },
  { icon: Store, label: "Store connector", tab: "store_connector" },
  { icon: Settings2, label: "Settings", tab: "settings" },
];

const COLLAPSED_STORAGE_KEY = "maxform.sidebar.collapsed";

/**
 * Keeps the active nav row inside the scrollport. Uses rects rather than
 * offsetTop because the sticky <aside> is the offsetParent, not the <nav>.
 */
function useScrollActiveIntoView(
  navRef: React.RefObject<HTMLElement>,
  activeItemRef: React.RefObject<HTMLElement>,
  deps: unknown[],
) {
  const hasRunRef = useRef(false);

  useEffect(() => {
    const nav = navRef.current;
    const item = activeItemRef.current;
    if (!nav || !item) return;

    const navBox = nav.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const padding = 12;

    let delta = 0;
    if (itemBox.top < navBox.top + padding) {
      delta = itemBox.top - navBox.top - padding;
    } else if (itemBox.bottom > navBox.bottom - padding) {
      delta = itemBox.bottom - navBox.bottom + padding;
    }

    if (delta !== 0) {
      const top = nav.scrollTop + delta;
      // scrollTo is missing on elements under jsdom.
      if (typeof nav.scrollTo === "function") {
        nav.scrollTo({ top, behavior: hasRunRef.current ? "smooth" : "auto" });
      } else {
        nav.scrollTop = top;
      }
    }

    hasRunRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function SidebarTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="px-2 py-1 text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({
  collapsed = false,
  onNavigate,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { profile, signOut } = useAuth();
  const workspaceIdentity = useWorkspaceIdentity();
  const workspaceLogo = workspaceIdentity.logoUrl;
  const workspaceName = workspaceIdentity.workspaceName.trim() || "Workspace";

  const requestedTab = searchParams.get("tab") || "home";
  const activeTab = requestedTab === "contacts" ? "crm" : requestedTab;
  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((name) => name[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "MF";

  const isAdmin = profile?.role === "admin";

  const navRef = useRef<HTMLElement>(null);
  const activeItemRef = useRef<HTMLAnchorElement>(null);

  useScrollActiveIntoView(navRef, activeItemRef, [
    activeTab,
    location.pathname,
    collapsed,
  ]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleButton = onToggleCollapse ? (
    <SidebarTooltip label="Expand sidebar" enabled={collapsed}>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className="h-7 w-7 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <ToggleIcon className="h-4 w-4" />
      </Button>
    </SidebarTooltip>
  ) : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "border-b border-sidebar-border",
          collapsed ? "flex flex-col items-center gap-2 px-2 py-3" : "px-3 py-3",
        )}
      >
        {collapsed ? (
          <>
            <BrandLogo markSize={18} showWordmark={false} />
            {toggleButton}
          </>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <BrandLogo
                markSize={18}
                wordmarkClassName="truncate text-[15px] text-sidebar-accent-foreground"
              />
              <span className="ml-[26px] block truncate text-[10px] uppercase text-sidebar-foreground">
                Workspace OS
              </span>
            </div>
            {toggleButton}
          </div>
        )}
      </div>

      <nav
        ref={navRef}
        className="dashboard-scroll flex-1 space-y-px overflow-y-auto px-2 py-2"
      >
        {navItems.map((item) => {
          const itemPath =
            item.tab === "settings"
              ? "/dashboard?tab=settings&section=workspace"
              : `/dashboard?tab=${item.tab}`;
          const isActive =
            location.pathname === "/dashboard" && activeTab === item.tab;
          return (
            <SidebarTooltip key={item.tab} label={item.label} enabled={collapsed}>
              <Link
                ref={isActive ? activeItemRef : undefined}
                to={itemPath}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? undefined : item.label}
                className={cn(
                  "relative flex items-center rounded-md py-2 text-[13px] transition-colors",
                  collapsed ? "justify-center px-0" : "gap-2 px-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-sidebar-primary" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </SidebarTooltip>
          );
        })}

        {isAdmin && (
          <>
            <div className="my-2 h-px bg-sidebar-border" />
            <SidebarTooltip label="Admin Panel" enabled={collapsed}>
              <Link
                ref={location.pathname === "/admin" ? activeItemRef : undefined}
                to="/admin"
                onClick={onNavigate}
                aria-current={location.pathname === "/admin" ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-md border py-2 text-[12px] transition-colors",
                  collapsed ? "justify-center px-0" : "gap-2 px-2",
                  location.pathname === "/admin"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-destructive/20 text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <span className="truncate font-semibold">Admin Panel</span>
                )}
              </Link>
            </SidebarTooltip>
          </>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        {!collapsed && (
          <div className="mb-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 p-2">
            <p className="truncate text-[11px] font-semibold text-sidebar-accent-foreground">
              {workspaceName}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-sidebar-foreground">
              Pro plan - 64% usage
            </p>
          </div>
        )}
        <div
          className={cn(
            "flex items-center",
            collapsed ? "flex-col gap-1.5" : "gap-2 px-1",
          )}
        >
          <SidebarTooltip
            label={`${profile?.full_name || "User"} - ${workspaceName}`}
            enabled={collapsed}
          >
            <Avatar className="h-6 w-6">
              <AvatarImage src={workspaceLogo || ""} className="object-cover" />
              <AvatarFallback className="bg-sidebar-primary text-[9px] leading-none text-sidebar-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </SidebarTooltip>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-[12px] text-sidebar-foreground">
              {profile?.full_name || "User"}
            </span>
          )}
          <SidebarTooltip label="Sign out" enabled={collapsed}>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sign out"
              className="h-6 w-6 text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-3 w-3" />
            </Button>
          </SidebarTooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

function readStoredCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Storage can be unavailable (private mode); collapse still works in-session.
    }
  }, [collapsed]);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      </div>
    </aside>
  );
}
