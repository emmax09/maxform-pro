import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Archive,
  ArchiveRestore,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FolderKanban,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Settings2,
  Table2,
  Ticket,
  Trash2,
  UserPlus,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { FormsTab } from "@/components/forms/FormsModule";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import {
  PROJECT_LANDING_TABS,
  type ProjectsTab,
} from "@/components/projects/project-tabs";
import {
  TableBulkActions,
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import {
  projectIcon,
  projectSwatch,
  projectTint,
} from "@/components/projects/project-visuals";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { useTableSelection } from "@/hooks/use-table-selection";
import {
  archiveProject,
  assignItemToProject,
  createProject,
  deleteProject,
  deleteProjects,
  getProject,
  getProjectOverview,
  inviteToProject,
  listAssignableItems,
  listProjectItems,
  listProjects,
  restoreProject,
  revokeProjectAccess,
  setProjectsStatus,
  updateProject,
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectItemKind,
  type ProjectItemView,
  type ProjectSummary,
} from "@/lib/projects";
import { formatCurrency } from "@/lib/regional-options";
import { cn } from "@/lib/utils";

export type { ProjectsTab };

// The real modules, loaded on demand. A project tab mounts the same component
// the dashboard mounts, so there is exactly one Form Builder, one event
// editor, and one file library in the product.
const FormsModule = lazy(() =>
  import("@/components/forms/FormsModule").then((module) => ({
    default: module.FormsModule,
  })),
);
const EventsModule = lazy(() =>
  import("@/components/events/EventsModule").then((module) => ({
    default: module.EventsModule,
  })),
);
const FilesModule = lazy(() =>
  import("@/components/files/FilesModule").then((module) => ({
    default: module.FilesModule,
  })),
);

type ProjectsModuleProps = {
  activeTab: ProjectsTab;
  /** Passed through to the embedded Forms module for its greeting copy. */
  fullName: string;
  onOpenProject: (projectId: string | null) => void;
  onTabChange: (tab: ProjectsTab) => void;
  projectId?: string | null;
  userId?: string;
};

const projectsQueryKey = (userId: string) => ["projects", "list", userId];

const CALLOUT_STORAGE_KEY = "maxform.projects.callout-seen";

const readCalloutSeen = () => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CALLOUT_STORAGE_KEY) === "true";
  } catch {
    // Private mode blocks storage; showing the callout once per session is a
    // better failure than never explaining the tab at all.
    return false;
  }
};

const relativeTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet active";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

const initialsFor = (value: string) =>
  value
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

/** "3 forms · 2 workflows · 1 event", with the empty parts left out. */
const itemSummary = (project: {
  eventCount: number;
  formCount: number;
  workflowCount: number;
}) => {
  const parts = [
    [project.formCount, "form"],
    [project.workflowCount, "workflow"],
    [project.eventCount, "event"],
  ] as const;
  const filled = parts
    .filter(([value]) => value > 0)
    .map(([value, noun]) => `${value} ${noun}${value === 1 ? "" : "s"}`);
  return filled.length ? filled.join(" · ") : "Nothing assigned yet";
};

function EmptyPanel({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function AccessAvatars({
  members,
}: {
  members: ProjectSummary["access"];
}) {
  const shown = members.slice(0, 4);
  const overflow = members.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((member) => (
        <Avatar
          key={member.id}
          className="h-6 w-6 border border-background"
          title={`${member.name} (${member.role})`}
        >
          <AvatarFallback className="bg-muted text-[9px] font-semibold">
            {initialsFor(member.name || member.email)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-semibold text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Creating a project should take ten seconds. One field is required; the icon
 * and color are one click each, and the same form is reused for renaming so
 * there is only one place to learn.
 */
function ProjectForm({
  busy,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  busy: boolean;
  initial?: ProjectSummary;
  onCancel: () => void;
  onSubmit: (value: {
    color: string;
    description: string;
    icon: string;
    name: string;
  }) => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [icon, setIcon] = useState<string>(initial?.icon || "folder");
  const [color, setColor] = useState<string>(initial?.color || "blue");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSubmit({ color, description, icon, name: name.trim() });
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Corp"
          maxLength={120}
          autoFocus
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label>Icon</Label>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_ICONS.map((option) => {
            const Icon = projectIcon(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => setIcon(option)}
                aria-label={option}
                aria-pressed={icon === option}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                  icon === option
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-label={option}
              aria-pressed={color === option}
              className={cn(
                "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition-all",
                projectSwatch(option),
                color === option ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
              )}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-description">Description (optional)</Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What this project covers"
          maxLength={500}
          rows={2}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProjectCard({
  onOpen,
  onToggle,
  project,
  selected,
}: {
  onOpen: () => void;
  onToggle: (checked: boolean) => void;
  project: ProjectSummary;
  selected: boolean;
}) {
  const Icon = projectIcon(project.icon);
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/30">
      <div className="flex items-start justify-between gap-3">
        <TableRowSelect
          checked={selected}
          onCheckedChange={onToggle}
          label={`Select ${project.name}`}
          className="-ml-2 -mt-2"
        />
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            projectTint(project.color),
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        {project.status === "archived" ? (
          <Badge variant="outline" className="text-[10px]">
            Archived
          </Badge>
        ) : null}
      </div>
      <button type="button" onClick={onOpen} className="mt-1 min-w-0 text-left">
        <h3 className="truncate text-[15px] font-semibold text-foreground">
          {project.name}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[32px] text-[12px] leading-4 text-muted-foreground">
          {project.description || "No description"}
        </p>
        <p className="mt-3 truncate text-[11px] font-medium text-muted-foreground">
          {itemSummary(project)}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
          <AccessAvatars members={project.access} />
          <span className="truncate text-[10px] text-muted-foreground">
            {relativeTime(project.lastActiveAt)}
          </span>
        </div>
      </button>
    </article>
  );
}

function ProjectsTable({
  onOpenProject,
  onToggle,
  projects,
  selected,
}: {
  onOpenProject: (projectId: string) => void;
  onToggle: (projectId: string, checked: boolean) => void;
  projects: ProjectSummary[];
  selected: (projectId: string) => boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="w-12" />
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Contents</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => {
            const Icon = projectIcon(project.icon);
            return (
              <TableRow key={project.id}>
                <TableCell>
                  <TableRowSelect
                    checked={selected(project.id)}
                    onCheckedChange={(checked) => onToggle(project.id, checked)}
                    label={`Select ${project.name}`}
                    className="-ml-2"
                  />
                </TableCell>
                <TableCell className="min-w-[220px]">
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        projectTint(project.color),
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-foreground">
                        {project.name}
                      </span>
                      <span className="mt-0.5 block max-w-[300px] truncate text-[11px] text-muted-foreground">
                        {project.description || "No description"}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={project.status === "archived" ? "outline" : "secondary"}
                    className="text-[10px]"
                  >
                    {project.status === "archived" ? "Archived" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">
                  {itemSummary(project)}
                </TableCell>
                <TableCell>
                  <AccessAvatars members={project.access} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {relativeTime(project.lastActiveAt)}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onOpenProject(project.id)}
                    aria-label={`Open ${project.name}`}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function AllProjectsGrid({
  activeTab,
  onOpenProject,
  onTabChange,
  userId,
}: {
  activeTab: ProjectsTab;
  onOpenProject: (projectId: string) => void;
  onTabChange: (tab: ProjectsTab) => void;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">(
    "active",
  );
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [memberFilter, setMemberFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calloutSeen, setCalloutSeen] = useState(readCalloutSeen);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const dismissCallout = () => {
    setCalloutSeen(true);
    try {
      window.localStorage.setItem(CALLOUT_STORAGE_KEY, "true");
    } catch {
      // Nothing to do; the callout simply returns next session.
    }
  };

  const projectsQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: listProjects,
    queryKey: projectsQueryKey(userId),
    staleTime: 15_000,
  });

  // Everyone who can see at least one project, so the filter offers real
  // people rather than a fixed list that may not match this workspace.
  const memberOptions = useMemo(() => {
    const byEmail = new Map<string, { email: string; name: string }>();
    (projectsQuery.data?.projects || []).forEach((project) => {
      project.access.forEach((member) => {
        const key = member.email.toLowerCase();
        if (key && !byEmail.has(key)) {
          byEmail.set(key, { email: member.email, name: member.name });
        }
      });
    });
    return Array.from(byEmail.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [projectsQuery.data]);

  useEffect(() => {
    if (
      memberFilter !== "all" &&
      !memberOptions.some((member) => member.email.toLowerCase() === memberFilter)
    ) {
      setMemberFilter("all");
    }
  }, [memberFilter, memberOptions]);

  const effectiveStatusFilter =
    activeTab === "archived"
      ? "archived"
      : activeTab === "all"
        ? "all"
        : statusFilter;

  const projects = useMemo(() => {
    const all = projectsQuery.data?.projects || [];
    const term = search.trim().toLowerCase();
    const filtered = all.filter((project) => {
      if (effectiveStatusFilter !== "all" && project.status !== effectiveStatusFilter) return false;
      if (
        memberFilter !== "all" &&
        !project.access.some(
          (member) => member.email.toLowerCase() === memberFilter,
        )
      ) {
        return false;
      }
      if (!term) return true;
      return (
        project.name.toLowerCase().includes(term) ||
        project.description.toLowerCase().includes(term) ||
        project.access.some((member) =>
          `${member.name} ${member.email}`.toLowerCase().includes(term),
        )
      );
    });
    return sort === "name"
      ? [...filtered].sort((left, right) => left.name.localeCompare(right.name))
      : filtered;
  }, [effectiveStatusFilter, memberFilter, projectsQuery.data, search, sort]);

  const selection = useTableSelection(projects.map((project) => project.id));
  const pagination = useTablePagination(
    projects,
    10,
    `${activeTab}:${search}:${effectiveStatusFilter}:${memberFilter}:${sort}`,
  );
  const selectedProjects = projects.filter((project) =>
    selection.selectedVisibleIds.includes(project.id),
  );
  const activeSelected = selectedProjects.filter((project) => project.status === "active");
  const archivedSelected = selectedProjects.filter((project) => project.status === "archived");

  const hasFilters =
    Boolean(search) || effectiveStatusFilter !== "active" || memberFilter !== "all";

  const handleCreate = async (value: {
    color: string;
    description: string;
    icon: string;
    name: string;
  }) => {
    setSaving(true);
    try {
      const result = await createProject(value);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setCreating(false);
      toast.success(`${result.project.name} created.`);
      onOpenProject(result.project.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not created.",
      );
    } finally {
      setSaving(false);
    }
  };

  const downloadSelected = () => {
    const rows = [
      ["Project", "Status", "Description", "Forms", "Workflows", "Events", "Files"],
      ...selectedProjects.map((project) => [
        project.name,
        project.status,
        project.description,
        String(project.formCount),
        String(project.workflowCount),
        String(project.eventCount),
        String(project.fileCount),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "maxform-projects.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"} exported.`);
  };

  const handleBulkStatus = async (nextStatus: "active" | "archived") => {
    const target = nextStatus === "archived" ? activeSelected : archivedSelected;
    if (!target.length) return;
    setBulkBusy(true);
    try {
      await setProjectsStatus(target.map((project) => project.id), nextStatus);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      selection.clearSelection();
      toast.success(
        `${target.length} project${target.length === 1 ? "" : "s"} ${nextStatus === "archived" ? "archived" : "restored"}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The projects could not be updated.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedProjects.length) return;
    setBulkBusy(true);
    try {
      const result = await deleteProjects(
        selectedProjects.map((project) => ({ id: project.id, name: project.name })),
      );
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      selection.clearSelection();
      setBulkDeleteOpen(false);
      toast.success(
        `${result.deleted} project${result.deleted === 1 ? "" : "s"} deleted. Their work was moved back to the main lists.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The projects could not be deleted.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="min-w-0 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <FolderKanban className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
              Projects
            </p>
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight sm:text-[38px]">
            Projects
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            Group forms, workflows, events, and files under one client or
            initiative — and decide who on your team can see each one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => void projectsQuery.refetch()}
            disabled={projectsQuery.isFetching}
            aria-label="Refresh projects"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                projectsQuery.isFetching && "animate-spin",
              )}
            />
          </Button>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </div>
      </header>

      <nav
        className="dashboard-scroll dashboard-scroll-x mt-7 flex w-full items-end gap-x-1 overflow-x-auto border-b border-border"
        aria-label="Projects sections"
      >
        {PROJECT_LANDING_TABS.map((tab) => {
          const label = tab === "overview" ? "Overview" : tab === "all" ? "All projects" : "Archived";
          const Icon = tab === "overview" ? Activity : tab === "all" ? FolderKanban : Archive;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-[12px]",
                activeTab === tab && "text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {activeTab === tab ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
            </button>
          );
        })}
      </nav>

      {!calloutSeen ? (
        <aside className="mt-6 flex flex-wrap items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">
              What a project is.
            </span>{" "}
            A project groups forms, workflows, events, and files for one client
            or initiative, and controls which teammates can see them. Contacts
            and payments stay workspace-wide, so a person stays one record no
            matter which project they came through.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={dismissCallout}>
            Got it
          </Button>
        </aside>
      ) : null}

      <TableFilterBar
        className="mt-7 lg:flex-row lg:items-center"
        label="Project filters"
      >
        <TableSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search projects or members"
          className="sm:max-w-xs"
          aria-label="Search projects"
        />
        <TableFilterSelect
          value={effectiveStatusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as "active" | "archived" | "all")
          }
          label="Filter by status"
          className="sm:w-[150px]"
          disabled={activeTab !== "overview"}
          options={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All projects" },
          ]}
        />
        <TableFilterSelect
          value={memberFilter}
          onValueChange={setMemberFilter}
          label="Filter by team member"
          className="sm:w-[190px]"
          options={[
            { value: "all", label: "Anyone with access" },
            ...memberOptions.map((member) => ({
              value: member.email.toLowerCase(),
              label: member.name,
            })),
          ]}
        />
        <TableFilterSelect
          value={sort}
          onValueChange={(value) => setSort(value as "recent" | "name")}
          label="Sort projects"
          className="sm:w-[170px]"
          options={[
            { value: "recent", label: "Recently active" },
            { value: "name", label: "Name (A-Z)" },
          ]}
        />
      </TableFilterBar>

      <div className="mt-3 flex justify-end">
        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-card/70 p-1">
          <Button type="button" size="icon" variant={viewMode === "grid" ? "secondary" : "ghost"} className="h-8 w-8" onClick={() => setViewMode("grid")} aria-label="Grid view">
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant={viewMode === "table" ? "secondary" : "ghost"} className="h-8 w-8" onClick={() => setViewMode("table")} aria-label="Table view">
            <Table2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <TableSelectionBar
        totalCount={projects.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="projects"
      >
        <TableBulkActions
          label="Project actions"
          actions={[
            { key: "export", label: "Export selected", icon: <ArrowUpRight className="h-3.5 w-3.5" />, onSelect: downloadSelected },
            { key: "archive", label: "Archive selected", icon: <Archive className="h-3.5 w-3.5" />, disabled: bulkBusy || !activeSelected.length, onSelect: () => void handleBulkStatus("archived") },
            { key: "restore", label: "Restore selected", icon: <ArchiveRestore className="h-3.5 w-3.5" />, disabled: bulkBusy || !archivedSelected.length, onSelect: () => void handleBulkStatus("active") },
            { key: "delete", label: "Delete selected", icon: <Trash2 className="h-3.5 w-3.5" />, destructive: true, separatorBefore: true, disabled: bulkBusy, onSelect: () => setBulkDeleteOpen(true) },
          ]}
        />
      </TableSelectionBar>

      <div className="mt-6">
        {projectsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-[196px] rounded-2xl" />
            ))}
          </div>
        ) : projectsQuery.isError ? (
          <EmptyPanel
            icon={FolderKanban}
            title="Projects could not be loaded"
            description={
              projectsQuery.error instanceof Error
                ? projectsQuery.error.message
                : "Please try again."
            }
            action={
              <Button variant="outline" onClick={() => void projectsQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : viewMode === "table" ? (
          projects.length ? (
            <>
              <ProjectsTable
                projects={pagination.pageItems}
                selected={selection.isSelected}
                onToggle={selection.toggle}
                onOpenProject={onOpenProject}
              />
              <TablePagination
                page={pagination.page}
                pageCount={pagination.pageCount}
                pageSize={pagination.pageSize}
                totalCount={pagination.totalCount}
                onPageChange={pagination.setPage}
                itemLabel="projects"
                className="mt-4"
              />
            </>
          ) : (
            <EmptyPanel
              icon={FolderKanban}
              title={hasFilters ? "No projects match this view" : "No projects yet"}
              description={hasFilters ? "Clear the search or change the filters to see the rest." : "Create a project to group forms, workflows, events, and files under one initiative."}
              action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New project</Button>}
            />
          )
        ) : (
          <PaginatedCardGrid
            items={projects}
            pageSize={10}
            itemLabel="projects"
            getKey={(project) => project.id}
            resetKey={`${activeTab}:${search}:${effectiveStatusFilter}:${memberFilter}:${sort}`}
            renderItem={(project) => (
              <ProjectCard
                project={project}
                selected={selection.isSelected(project.id)}
                onToggle={(checked) => selection.toggle(project.id, checked)}
                onOpen={() => onOpenProject(project.id)}
              />
            )}
            emptyState={
              <EmptyPanel
                icon={FolderKanban}
                title={
                  hasFilters
                    ? "No projects match this view"
                    : "No projects yet"
                }
                description={
                  hasFilters
                    ? "Clear the search or change the status and member filters to see the rest."
                    : "A project groups the forms, workflows, and events for one client or initiative. Everything stays where it is until you assign it."
                }
                action={
                  <Button onClick={() => setCreating(true)}>
                    <Plus className="h-4 w-4" />
                    New project
                  </Button>
                }
              />
            }
          />
        )}
      </div>

      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Name it now; assign forms, workflows, and events whenever you like.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            busy={saving}
            submitLabel="Create project"
            onCancel={() => setCreating(false)}
            onSubmit={(value) => void handleCreate(value)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => !open && setBulkDeleteOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedProjects.length} projects?</DialogTitle>
            <DialogDescription>
              The selected project folders will be deleted together. Forms,
              workflows, and events will be unassigned and kept safely in their
              main modules. Responses, payments, and files are not deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
            {selectedProjects.map((project) => (
              <p key={project.id} className="truncate py-0.5">
                {project.name}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleBulkDelete()}
              disabled={bulkBusy || !selectedProjects.length}
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete projects
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  hint,
  icon: Icon,
  label,
  value,
}: {
  hint: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-[11px] font-medium uppercase tracking-widest">
          {label}
        </p>
      </div>
      <p className="mt-3 text-[26px] font-semibold tracking-[-0.02em]">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function ProjectOverviewPanel({
  project,
  userId,
}: {
  project: ProjectSummary;
  userId: string;
}) {
  const overviewQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: () => getProjectOverview(project.id),
    queryKey: ["projects", "overview", userId, project.id],
    staleTime: 15_000,
  });
  const overview = overviewQuery.data?.overview;

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-[124px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <EmptyPanel
        icon={Activity}
        title="This overview could not be loaded"
        description={
          overviewQuery.error instanceof Error
            ? overviewQuery.error.message
            : "Please try again."
        }
        action={
          <Button variant="outline" onClick={() => void overviewQuery.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const activityIcons: Record<string, LucideIcon> = {
    file: FolderOpen,
    payment: CircleDollarSign,
    registration: Ticket,
    response: Inbox,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Inbox}
          label="Responses"
          value={String(overview.responsesThisMonth)}
          hint="This month, across this project"
        />
        <StatCard
          icon={Ticket}
          label="Registrations"
          value={String(overview.registrationsThisMonth)}
          hint="This month, across this project"
        />
        <StatCard
          icon={CircleDollarSign}
          label="Revenue"
          value={formatCurrency(overview.revenueThisMonth, overview.currency)}
          hint="Confirmed payments this month"
        />
        <StatCard
          icon={FolderKanban}
          label="Assigned work"
          value={String(
            overview.formCount + overview.workflowCount + overview.eventCount,
          )}
          hint={itemSummary(overview)}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-semibold">Recent activity</h3>
        </header>
        {overview.activity.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">
            Nothing has happened in this project yet. Responses, registrations,
            payments, and files will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {overview.activity.map((entry) => {
              const Icon = activityIcons[entry.kind] || Activity;
              return (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {entry.title}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {entry.subtitle}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(entry.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const ITEM_VIEWS: Record<
  Exclude<ProjectItemView, "files">,
  { kind: ProjectItemKind; moduleTab: string; noun: string }
> = {
  events: { kind: "event", moduleTab: "events", noun: "event" },
  forms: { kind: "form", moduleTab: "forms", noun: "form" },
  workflows: { kind: "workflow", moduleTab: "workflows", noun: "workflow" },
};

/**
 * A project's Forms / Workflows / Events / Files tab.
 *
 * This mounts the real module -- the same Form Builder, the same event editor,
 * the same file library -- with its list narrowed to this project and its own
 * title and tab strip suppressed, because the project page already supplies
 * those. There is no separate "project forms" feature; it is one module viewed
 * through a project's lens, and anything created here is filed here.
 */
function ProjectWorkPanel({
  fullName,
  project,
  userId,
  view,
}: {
  fullName: string;
  project: ProjectSummary;
  userId: string;
  view: ProjectItemView;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState("");
  const [formsTab, setFormsTab] = useState<FormsTab>(
    view === "workflows" ? "automations" : "all",
  );
  const config = view === "files" ? null : ITEM_VIEWS[view];

  const assignableQuery = useQuery({
    enabled: adding && Boolean(config),
    queryFn: () => listAssignableItems(config!.kind),
    queryKey: ["projects", "assignable", userId, config?.kind],
    staleTime: 15_000,
  });

  const available = (assignableQuery.data?.items || []).filter(
    (item) => item.projectId !== project.id,
  );

  const handleAssign = async (itemId: string) => {
    if (!config) return;
    setAssigning(itemId);
    try {
      await assignItemToProject(config.kind, itemId, project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Added to ${project.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The assignment did not save.",
      );
    } finally {
      setAssigning("");
    }
  };

  const blurb =
    view === "files"
      ? "Every upload and signed document this project's forms and events produced."
      : view === "events"
        ? `Events filed under ${project.name}. Creating one here files it here.`
        : view === "workflows"
          ? `Automations filed under ${project.name}.`
          : `Forms filed under ${project.name}. Creating one here files it here.`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">{blurb}</p>
        {config ? (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add existing
          </Button>
        ) : null}
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-[220px] w-full rounded-2xl" />
          </div>
        }
      >
        {view === "files" ? (
          <FilesModule
            embedded
            initialTab="all"
            projectId={project.id}
            userId={userId}
          />
        ) : view === "events" ? (
          <EventsModule
            embedded
            initialTab="all"
            projectId={project.id}
            userId={userId}
          />
        ) : (
          <FormsModule
            activeTab={formsTab}
            embedded
            fullName={fullName}
            onTabChange={setFormsTab}
            projectId={project.id}
            userId={userId}
          />
        )}
      </Suspense>

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {config?.noun} to {project.name}
            </DialogTitle>
            <DialogDescription>
              Moving an item here only changes where it is filed. Nothing is
              duplicated, and nothing is removed from its module.
            </DialogDescription>
          </DialogHeader>
          {assignableQuery.isLoading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : available.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Everything available is already in this project.
            </p>
          ) : (
            <ul className="dashboard-scroll max-h-[320px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {available.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{item.title}</p>
                    {item.projectName ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        Currently in {item.projectName}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={assigning === item.id}
                    onClick={() => void handleAssign(item.id)}
                  >
                    {assigning === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectTeamAccessPanel({
  project,
  userId,
}: {
  project: ProjectSummary;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);

  const members = project.access;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await inviteToProject(project.id, email.trim(), role);
      setEmail("");
      await refresh();
      toast.success(`Invitation scoped to ${project.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The invitation was not sent.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    try {
      await revokeProjectAccess(project.id, invitationId);
      await refresh();
      toast.success("Access removed from this project.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Access was not changed.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Invite into this project</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Someone invited here sees this project and nothing else — useful when
          a contractor is onboarded for one client.
        </p>
        <form
          onSubmit={(event) => void handleInvite(event)}
          className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]"
        >
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="pl-10"
              required
            />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Member</SelectItem>
              <SelectItem value="moderator">Manager</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Invite
          </Button>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <UsersRound className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-semibold">
            Who can see {project.name}
          </h3>
        </header>
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-muted text-[10px] font-semibold">
                  {initialsFor(member.name || member.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{member.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 capitalize">
                {member.role === "user" ? "member" : member.role}
              </Badge>
              <Badge
                variant={member.scoped ? "secondary" : "outline"}
                className="hidden shrink-0 sm:inline-flex"
              >
                {member.scoped ? "This project only" : "All projects"}
              </Badge>
              {member.scoped ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRevoke(member.id)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] leading-5 text-muted-foreground">
        A member with no project scope sees every project. A scoped member only
        ever sees the projects listed for them — checked in the API before any
        form, workflow, event, or file is returned.
      </p>
    </div>
  );
}

function ProjectSettingsPanel({
  onDeleted,
  project,
}: {
  onDeleted: () => void;
  project: ProjectSummary;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const handleSave = async (value: {
    color: string;
    description: string;
    icon: string;
    name: string;
  }) => {
    setSaving(true);
    try {
      await updateProject({ ...value, id: project.id });
      await refresh();
      setEditing(false);
      toast.success("Project updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not updated.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async () => {
    setBusy(true);
    try {
      if (project.status === "archived") {
        await restoreProject(project.id);
        toast.success(`${project.name} restored.`);
      } else {
        await archiveProject(project.id);
        toast.success(`${project.name} archived. Everything inside is intact.`);
      }
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not updated.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const result = await deleteProject(project.id, confirmName);
      await refresh();
      setDeleting(false);
      const moved =
        result.unassigned.forms +
        result.unassigned.workflows +
        result.unassigned.events;
      toast.success(
        moved > 0
          ? `${project.name} deleted. ${moved} item${moved === 1 ? "" : "s"} moved back to the main lists.`
          : `${project.name} deleted.`,
      );
      onDeleted();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not deleted.",
      );
    } finally {
      setBusy(false);
    }
  };

  const Icon = projectIcon(project.icon);
  const totalItems =
    project.formCount + project.workflowCount + project.eventCount;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Name and appearance</h3>
        <div className="mt-4 flex items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl",
              projectTint(project.color),
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{project.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {project.description || "No description"}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">
          {project.status === "archived" ? "Restore project" : "Archive project"}
        </h3>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
          {project.status === "archived"
            ? "Bring this project back into the active list. Nothing inside it changed while it was archived."
            : "Archiving hides this project from the active list. Everything inside stays fully intact and can be reopened at any time — this is the right choice when a client relationship ends."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          disabled={busy}
          onClick={() => void handleStatus()}
        >
          {project.status === "archived" ? (
            <ArchiveRestore className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          {project.status === "archived" ? "Restore project" : "Archive project"}
        </Button>
      </section>

      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <h3 className="text-[13px] font-semibold text-destructive">
          Delete project
        </h3>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
          Deleting removes the folder only.{" "}
          {totalItems > 0
            ? `The ${totalItems} item${totalItems === 1 ? "" : "s"} inside become unassigned and reappear in the main Forms, Workflows, and Events lists.`
            : "There is nothing filed here."}{" "}
          Responses, payments, and files are never deleted.
        </p>
        <Button
          type="button"
          variant="destructive"
          className="mt-4"
          onClick={() => {
            setConfirmName("");
            setDeleting(true);
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete project
        </Button>
      </section>

      <Dialog open={editing} onOpenChange={(open) => !open && setEditing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Renaming a project does not move anything inside it.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            busy={saving}
            initial={project}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={(value) => void handleSave(value)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={(open) => !open && setDeleting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              Type <span className="font-semibold text-foreground">{project.name}</span>{" "}
              to confirm. The work inside is unassigned, not deleted.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={project.name}
            aria-label="Confirm project name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy ||
                confirmName.trim().toLowerCase() !== project.name.toLowerCase()
              }
              onClick={() => void handleDelete()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DETAIL_TABS: Array<{ icon: LucideIcon; key: ProjectsTab; label: string }> = [
  { icon: Activity, key: "overview", label: "Overview" },
  { icon: ClipboardList, key: "forms", label: "Forms" },
  { icon: Workflow, key: "workflows", label: "Workflows" },
  { icon: Ticket, key: "events", label: "Events" },
  { icon: FolderOpen, key: "files", label: "Files" },
  { icon: UsersRound, key: "team", label: "Team access" },
  { icon: Settings2, key: "settings", label: "Settings" },
];

function ProjectDetail({
  activeTab,
  fullName,
  onBack,
  onTabChange,
  projectId,
  userId,
}: {
  activeTab: ProjectsTab;
  fullName: string;
  onBack: () => void;
  onTabChange: (tab: ProjectsTab) => void;
  projectId: string;
  userId: string;
}) {
  const projectQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: () => getProject(projectId),
    queryKey: ["projects", "detail", userId, projectId],
    staleTime: 15_000,
  });
  const project = projectQuery.data?.project;

  if (projectQuery.isLoading) {
    return (
      <div className="min-w-0 space-y-6 pb-12">
        <Skeleton className="h-16 w-72 rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-w-0 pb-12">
        <Button variant="ghost" onClick={onBack} className="mb-6">
          <ArrowLeft className="h-4 w-4" />
          All projects
        </Button>
        <EmptyPanel
          icon={FolderKanban}
          title="This project is not available"
          description={
            projectQuery.error instanceof Error
              ? projectQuery.error.message
              : "It may have been deleted, or it is outside the projects you can see."
          }
          action={<Button onClick={onBack}>Back to all projects</Button>}
        />
      </div>
    );
  }

  const Icon = projectIcon(project.icon);

  return (
    <div className="min-w-0 pb-12">
      <Button variant="ghost" onClick={onBack} className="-ml-2 mb-4 h-8 px-2">
        <ArrowLeft className="h-4 w-4" />
        All projects
      </Button>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              projectTint(project.color),
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[26px] font-semibold tracking-tight sm:text-[32px]">
                {project.name}
              </h1>
              {project.status === "archived" ? (
                <Badge variant="outline">Archived</Badge>
              ) : null}
            </div>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">
              {itemSummary(project)} · Active {relativeTime(project.lastActiveAt)}
            </p>
          </div>
        </div>
        <AccessAvatars members={project.access} />
      </header>

      <nav
        className="dashboard-scroll dashboard-scroll-x mt-7 flex w-full items-end gap-x-1 overflow-x-auto border-b border-border"
        aria-label={`${project.name} sections`}
      >
        {DETAIL_TABS.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-[12px]",
                activeTab === tab.key && "text-foreground",
              )}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {tab.label}
              {activeTab === tab.key ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-6">
        {activeTab === "overview" ? (
          <ProjectOverviewPanel project={project} userId={userId} />
        ) : activeTab === "team" ? (
          <ProjectTeamAccessPanel project={project} userId={userId} />
        ) : activeTab === "settings" ? (
          <ProjectSettingsPanel project={project} onDeleted={onBack} />
        ) : (
          <ProjectWorkPanel
            key={activeTab}
            fullName={fullName}
            project={project}
            userId={userId}
            view={activeTab as ProjectItemView}
          />
        )}
      </div>
    </div>
  );
}

export function ProjectsModule({
  activeTab,
  fullName,
  onOpenProject,
  onTabChange,
  projectId,
  userId,
}: ProjectsModuleProps) {
  useEffect(() => {
    const isLandingTab = PROJECT_LANDING_TABS.includes(activeTab);
    if ((projectId && isLandingTab) || (!projectId && !isLandingTab)) {
      onTabChange("overview");
    }
  }, [activeTab, onTabChange, projectId]);

  if (!userId) {
    return (
      <EmptyPanel
        icon={FolderKanban}
        title="Sign in to open projects"
        description="Projects are scoped to your authenticated workspace."
      />
    );
  }

  if (projectId) {
    return (
      <ProjectDetail
        activeTab={activeTab}
        fullName={fullName}
        onBack={() => onOpenProject(null)}
        onTabChange={onTabChange}
        projectId={projectId}
        userId={userId}
      />
    );
  }

  return (
    <AllProjectsGrid
      activeTab={activeTab}
      onOpenProject={onOpenProject}
      onTabChange={onTabChange}
      userId={userId}
    />
  );
}
