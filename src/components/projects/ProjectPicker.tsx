import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderKanban, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { projectIcon, projectTint } from "@/components/projects/project-visuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  assignItemToProject,
  createProject,
  listProjects,
  type ProjectItemKind,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

type ProjectBadge = {
  color: string;
  icon: string;
  id: string;
  name: string;
};

type ProjectPickerProps = {
  assignmentLoading?: boolean;
  className?: string;
  itemId: string;
  kind: ProjectItemKind;
  onAssigned?: (projectId: string | null) => void;
  /** The item's stored assignment. The picker owns the value after that. */
  projectId: string | null;
  projectName?: string | null;
  userId?: string;
};

/**
 * The Project field that lives in a form's, workflow's, or event's own
 * settings. Nothing is forced into a project: "No project" is always the first
 * option, and an unassigned item stays fully visible in its module.
 */
export function ProjectPicker({
  assignmentLoading = false,
  className,
  itemId,
  kind,
  onAssigned,
  projectId,
  projectName,
  userId,
}: ProjectPickerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  // The picker writes the assignment itself, so it tracks the saved value
  // rather than waiting for whichever module owns the row to refetch.
  const [value, setValue] = useState<string | null>(projectId);
  const [chosen, setChosen] = useState<ProjectBadge | null>(null);

  // Only reset when the stored assignment actually differs from what this
  // picker already saved. Without the guard, the owning module refetching its
  // rows would clear the badge and the trigger would read "No project" for an
  // item that is in fact assigned.
  useEffect(() => {
    setValue((current) => (current === projectId ? current : projectId));
    setChosen((current) =>
      current && current.id === projectId ? current : null,
    );
  }, [projectId]);

  // Loaded whether or not the popover is open: the trigger has to name the
  // project on first paint. Every picker on a page shares this query key, so
  // a list of twenty forms still makes one request.
  const projectsQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: listProjects,
    queryKey: ["projects", "list", userId || ""],
    staleTime: 15_000,
  });

  const projects = (projectsQuery.data?.projects || []).filter(
    (project) => project.status === "active" || project.id === value,
  );
  // The trigger keeps rendering the chosen project after the popover closes,
  // including one just created, which the list has not refetched yet.
  const selected =
    projects.find((project) => project.id === value) ||
    (value && chosen?.id === value
      ? chosen
      : value && projectName
        ? {
            color: "slate",
            icon: "folder",
            id: value,
            name: projectName,
          }
        : undefined);

  const assign = async (
    nextProjectId: string | null,
    label?: ProjectBadge,
  ) => {
    setBusy(true);
    try {
      await assignItemToProject(kind, itemId, nextProjectId);
      setValue(nextProjectId);
      setChosen(label || null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onAssigned?.(nextProjectId);
      setOpen(false);
      toast.success(
        nextProjectId
          ? `Filed under ${label?.name || "project"}.`
          : "Removed from its project. It stays in your workspace.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const result = await createProject({ name });
      await assignItemToProject(kind, itemId, result.project.id);
      setValue(result.project.id);
      setChosen({
        color: result.project.color,
        icon: result.project.icon,
        id: result.project.id,
        name: result.project.name,
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onAssigned?.(result.project.id);
      setCreating(false);
      setNewName("");
      setOpen(false);
      toast.success(`${result.project.name} created and assigned.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The project was not created.",
      );
    } finally {
      setBusy(false);
    }
  };

  const SelectedIcon = projectIcon(selected?.icon || "folder");
  const selectedLabel =
    selected?.name ||
    (assignmentLoading
      ? "Loading project…"
      : value
        ? projectsQuery.isLoading
          ? "Loading project…"
          : "Assigned project"
        : "No project");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("justify-start gap-2", className)}
          aria-label="Project"
        >
          {selected ? (
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded",
                projectTint(selected.color),
              )}
            >
              <SelectedIcon className="h-3 w-3" />
            </span>
          ) : (
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate">{selectedLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {projectsQuery.isLoading ? (
          <div className="space-y-1 p-1">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-8 rounded" />
            ))}
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              disabled={busy}
              onClick={() => void assign(null)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            >
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">No project</span>
              {value === null ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
            {projects.map((project) => {
              const Icon = projectIcon(project.icon);
              return (
                <button
                  key={project.id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void assign(project.id, {
                      color: project.color,
                      icon: project.icon,
                      id: project.id,
                      name: project.name,
                    })
                  }
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                      projectTint(project.color),
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate">{project.name}</span>
                  {value === project.id ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-1 border-t border-border pt-1">
          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createAndAssign();
              }}
              className="flex items-center gap-1 p-1"
            >
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Project name"
                className="h-8 text-[13px]"
                maxLength={120}
                autoFocus
              />
              <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              New project
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
