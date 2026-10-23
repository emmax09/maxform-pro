import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Cloud,
  CloudUpload,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Files,
  Film,
  Folder,
  FolderPlus,
  Grid2X2,
  HardDrive,
  LayoutList,
  Loader2,
  Link2,
  MoreHorizontal,
  Move,
  PackageOpen,
  PenLine,
  Settings2,
  Search,
  Share2,
  Unlink,
  Trash2,
  Upload,
  Users,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import {
  TableFilterBar,
  TableFilterSelect,
  TableSearchField,
} from "@/components/shared/TableFilters";
import { CardGrid, PaginatedCardGrid } from "@/components/shared/CardGrid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  bulkUpdateWorkspaceFiles,
  clearWorkspaceStorage,
  createWorkspaceFolder,
  downloadStoredFile,
  exportWorkspaceCollection,
  exportWorkspaceFileSelection,
  getFilesWorkspace,
  getExternalStorageWorkspace,
  getWorkspaceFileContent,
  importExternalFileToMaxForm,
  linkExternalFile,
  listExternalStorageDrives,
  listExternalStorageItems,
  createExternalStorageFolder,
  copyWorkspaceFilesToExternal,
  retryExternalStorageOperation,
  unlinkExternalFile,
  moveWorkspaceFile,
  renameWorkspaceFile,
  restoreWorkspaceFile,
  saveFileSettings,
  shareWorkspaceFile,
  trashWorkspaceFile,
  uploadWorkspaceFile,
  type FilesView,
  type FileSettings,
  type FileSource,
  type FileTypeFilter,
  type ExternalStorageItem,
  type ExternalStorageProvider,
  type ExternalStorageWorkspace,
  type WorkspaceFile,
  type WorkspaceFileCollection,
  type WorkspaceFolder,
} from "@/lib/files-documents";
import {
  beginIntegrationConnection,
  openIntegrationPopup,
} from "@/lib/integrations";
import { cn } from "@/lib/utils";

export type FilesTab = FilesView;

type FilesModuleProps = {
  userId?: string;
  initialTab?: FilesTab;
  onTabChange?: (tab: FilesTab) => void;
  /**
   * Renders this module inside a project: the same Files workspace, narrowed
   * server-side to the files this project's forms and events produced.
   */
  projectId?: string | null;
  embedded?: boolean;
};

const fileQueryKey = (
  userId: string,
  view: FilesView,
  folderId: string | null,
  search: string,
  type: FileTypeFilter,
  source: FileSource | "",
  projectId: string | null,
) => [
  "workspace-files",
  userId,
  view,
  folderId,
  search,
  type,
  source,
  projectId || "",
];

const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
};

const formatDate = (value: string | null) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

const sourceNames: Record<FileSource, string> = {
  document: "Documents",
  event_upload: "Events",
  form_upload: "Forms",
  import: "Imports",
  manual: "Manual uploads",
};

const fileIcon = (file: WorkspaceFile) => {
  if (file.mimeType.startsWith("image/")) return FileImage;
  if (file.mimeType.startsWith("video/")) return Film;
  if (
    file.mimeType === "application/pdf" ||
    file.mimeType.startsWith("text/")
  ) {
    return FileText;
  }
  return File;
};

const fileMatchesType = (
  file: WorkspaceFile,
  type: FileTypeFilter,
) => {
  if (!type) return true;
  if (type === "signature") return file.fileKind === "signature";
  if (type === "image") {
    return (
      file.mimeType.startsWith("image/") && file.fileKind !== "signature"
    );
  }
  if (type === "video") return file.mimeType.startsWith("video/");
  if (type === "pdf") return file.mimeType === "application/pdf";
  if (type === "document") {
    return (
      file.mimeType.startsWith("text/") ||
      file.mimeType.includes("word") ||
      file.mimeType.includes("sheet") ||
      file.mimeType.includes("excel") ||
      file.mimeType.includes("presentation")
    );
  }
  return (
    !file.mimeType.startsWith("image/") &&
    !file.mimeType.startsWith("video/") &&
    !file.mimeType.startsWith("text/") &&
    file.mimeType !== "application/pdf" &&
    !file.mimeType.includes("word") &&
    !file.mimeType.includes("sheet") &&
    !file.mimeType.includes("excel") &&
    !file.mimeType.includes("presentation")
  );
};

function FileCardPreview({
  file,
  className,
}: {
  file: WorkspaceFile;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const image = file.mimeType.startsWith("image/");
  useEffect(() => {
    if (!image || visible) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [image, visible]);
  const contentQuery = useQuery({
    enabled: image && visible && !file.deletedAt,
    queryKey: ["workspace-file-card-preview", file.id],
    queryFn: () => getWorkspaceFileContent(file.id),
    staleTime: 5 * 60_000,
  });
  // File links are short-lived, so a tab left open long enough can hold one
  // that has expired. A single refetch swaps in a fresh link.
  const [retriedLink, setRetriedLink] = useState(false);
  const retryExpiredLink = () => {
    if (retriedLink) return;
    setRetriedLink(true);
    void contentQuery.refetch();
  };
  const Icon = fileIcon(file);
  const extension =
    file.name.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE";
  const previewUrl =
    contentQuery.data?.url || contentQuery.data?.contentData || "";

  if (image) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative flex overflow-hidden rounded-lg border border-border/70 bg-white",
          className,
        )}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${file.fileKind === "signature" ? "Signature" : "Image"} preview for ${file.name}`}
            loading="lazy"
            onError={retryExpiredLink}
            className={cn(
              "h-full w-full",
              file.fileKind === "signature"
                ? "object-contain p-2"
                : "object-cover",
            )}
          />
        ) : contentQuery.isLoading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-muted/50 text-muted-foreground">
            {file.fileKind === "signature" ? (
              <PenLine className="h-6 w-6" />
            ) : (
              <FileImage className="h-6 w-6" />
            )}
          </span>
        )}
        {file.fileKind === "signature" && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-foreground shadow-xs">
            Signature
          </span>
        )}
      </div>
    );
  }

  if (
    file.mimeType === "application/pdf" ||
    file.mimeType.startsWith("text/") ||
    file.mimeType.includes("word") ||
    file.mimeType.includes("sheet") ||
    file.mimeType.includes("excel") ||
    file.mimeType.includes("presentation")
  ) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/35 p-2",
          className,
        )}
      >
        <span className="relative flex h-[88%] w-[68%] max-w-[74px] flex-col rounded-[4px] border border-border bg-background p-2 shadow-xs">
          <FileText className="h-4 w-4 text-primary" />
          <span className="mt-2 h-1 w-full rounded bg-muted" />
          <span className="mt-1 h-1 w-4/5 rounded bg-muted" />
          <span className="mt-1 h-1 w-3/5 rounded bg-muted" />
          <span className="mt-auto truncate text-[7px] font-semibold text-muted-foreground">
            {extension}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-border/70 bg-muted/45 text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={1.5} />
    </div>
  );
}

function EmptyState({
  view,
  onUpload,
}: {
  view: FilesView;
  onUpload: () => void;
}) {
  const trash = view === "trash";
  const shared = view === "shared";
  return (
    <div className="flex min-h-[330px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {trash ? (
          <Trash2 className="h-5 w-5" />
        ) : shared ? (
          <Share2 className="h-5 w-5" />
        ) : (
          <Files className="h-5 w-5" />
        )}
      </span>
      <h3 className="mt-4 text-[15px] font-semibold text-foreground">
        {trash
          ? "Trash is empty"
          : shared
            ? "Nothing is shared yet"
            : "No files here yet"}
      </h3>
      <p className="mt-1.5 max-w-[360px] text-[12px] leading-5 text-muted-foreground">
        {trash
          ? "Deleted files stay recoverable for your selected retention period."
          : shared
            ? "Files with an active secure share link will appear here."
            : "Upload a file or wait for the next form response, event upload, or signed document."}
      </p>
      {!trash && !shared && (
        <Button type="button" size="sm" className="mt-5" onClick={onUpload}>
          <Upload className="h-4 w-4" />
          Upload file
        </Button>
      )}
    </div>
  );
}

function StoragePanel({
  usedBytes,
  quotaBytes,
  fileCount,
  sources,
  trashCount,
  onClear,
}: {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  sources: Array<{ sourceType: FileSource; bytes: number; count: number }>;
  trashCount: number;
  onClear: (scope: "trash" | "manual" | "all") => void;
}) {
  const percent = quotaBytes
    ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
    : 0;
  const sourceMap = new Map(
    sources.map((source) => [source.sourceType, source]),
  );
  const rows = (
    ["form_upload", "event_upload", "document", "manual", "import"] as const
  ).map((sourceType) => ({
    sourceType,
    bytes: sourceMap.get(sourceType)?.bytes || 0,
    count: sourceMap.get(sourceType)?.count || 0,
  }));
  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Workspace storage
            </p>
            <h2 className="mt-3 text-[28px] font-semibold tracking-tight text-foreground">
              {formatBytes(usedBytes)}
              <span className="ml-2 text-[15px] font-normal text-muted-foreground">
                of {formatBytes(quotaBytes)}
              </span>
            </h2>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardDrive className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-7 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.max(percent, usedBytes ? 1 : 0)}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
          <span>{percent}% used</span>
          <span>{fileCount} files</span>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <p className="text-[13px] font-semibold text-foreground">
          Storage by source
        </p>
        <div className="mt-5 space-y-4">
          {rows.map((row) => (
            <div key={row.sourceType}>
              <div className="flex items-center justify-between gap-4 text-[12px]">
                <span className="text-foreground">
                  {sourceNames[row.sourceType]}
                </span>
                <span className="text-muted-foreground">
                  {formatBytes(row.bytes)} · {row.count}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{
                    width: `${usedBytes ? Math.max(1, (row.bytes / usedBytes) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        </section>
      </div>

      <section className="mt-5 rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              Clear storage
            </p>
            <p className="mt-1.5 max-w-[560px] text-[11px] leading-5 text-muted-foreground">
              Move files to Trash first so they remain recoverable. Emptying
              Trash permanently removes those stored copies.
            </p>
          </div>
          <PackageOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onClear("manual")}
          >
            Clear manual uploads
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onClear("all")}
          >
            Move all to Trash
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onClear("trash")}
            disabled={!trashCount}
          >
            Empty Trash{trashCount ? ` (${trashCount})` : ""}
          </Button>
        </div>
      </section>
    </div>
  );
}

function FileSettingsPanel({
  settings,
  saving,
  onSave,
}: {
  settings: FileSettings;
  saving: boolean;
  onSave: (settings: FileSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              File preferences
            </h2>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              Choose how the Files workspace opens and organizes submission
              media.
            </p>
          </div>
          <Settings2 className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="text-[11px] font-medium text-foreground">
              Default file layout
            </span>
            <select
              value={draft.defaultView}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  defaultView: event.target.value as "grid" | "list",
                }))
              }
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground outline-hidden focus:ring-2 focus:ring-primary/25"
            >
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-medium text-foreground">
                Trash retention
              </span>
              <select
                value={draft.retentionDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    retentionDays: Number(event.target.value),
                  }))
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground outline-hidden focus:ring-2 focus:ring-primary/25"
              >
                {[7, 14, 30, 60, 90].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-foreground">
                Share-link expiry
              </span>
              <select
                value={draft.shareExpiryDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    shareExpiryDays: Number(event.target.value),
                  }))
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground outline-hidden focus:ring-2 focus:ring-primary/25"
              >
                {[1, 3, 7, 14, 30, 90].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-5 rounded-lg border border-border bg-muted/25 p-4">
            <div>
              <p className="text-[12px] font-medium text-foreground">
                Group submission files by source
              </p>
              <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
                Show one collection card for each form or event.
              </p>
            </div>
            <Switch
              checked={draft.groupBySource}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  groupBySource: checked,
                }))
              }
              aria-label="Group submission files by source"
            />
          </div>
        </div>

        <Button
          type="button"
          className="mt-6 w-full sm:w-auto"
          onClick={() => onSave(draft)}
          disabled={saving}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save file settings
        </Button>
      </section>

      <aside className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <p className="text-[13px] font-semibold text-foreground">
          Automatic collection sync
        </p>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          Images, signatures, and uploaded files are added as soon as a form or
          event submission stores them. Each item remains connected to its
          client and original response.
        </p>
        <div className="mt-5 space-y-3">
          {[
            "No manual import is required",
            "Client attribution stays attached",
            "Forms and events export separately",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-[11px] text-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {item}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SourceCollectionCard({
  collection,
  visibleFiles,
  exporting,
  selectedCount,
  onOpen,
  onExport,
  onToggleSelection,
}: {
  collection: WorkspaceFileCollection;
  visibleFiles: WorkspaceFile[];
  exporting: boolean;
  selectedCount: number;
  onOpen: () => void;
  onExport: () => void;
  onToggleSelection: (selected: boolean) => void;
}) {
  const SourceIcon = collection.sourceType === "event" ? CalendarDays : Files;
  const allSelected =
    visibleFiles.length > 0 && selectedCount === visibleFiles.length;
  const selectionState =
    selectedCount > 0 && !allSelected ? "indeterminate" : allSelected;
  const visibleBytes = visibleFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );
  return (
    <article
      className={cn(
        "group overflow-hidden rounded-xl border bg-card transition-colors",
        selectedCount
          ? "border-primary ring-1 ring-primary/15"
          : "border-border hover:border-primary/55",
      )}
    >
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SourceIcon className="h-5 w-5" />
          </span>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {collection.sourceType}
            </span>
            <Checkbox
              checked={selectionState}
              onCheckedChange={(checked) =>
                onToggleSelection(checked === true)
              }
              className="border-border data-[state=checked]:border-primary"
              aria-label={`Select files from ${collection.name}`}
            />
          </span>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-5 block w-full text-left"
        >
          <span className="block truncate text-[14px] font-semibold text-foreground">
            {collection.name}
          </span>
          <span className="mt-1.5 block text-[10.5px] text-muted-foreground">
            {visibleFiles.length}
            {visibleFiles.length !== collection.fileCount
              ? ` of ${collection.fileCount}`
              : ""}{" "}
            {collection.fileCount === 1 ? "file" : "files"} ·{" "}
            {collection.submissionCount}{" "}
            {collection.submissionCount === 1
              ? "submission"
              : "submissions"}{" "}
            · {formatBytes(visibleBytes)}
          </span>
          <span className="my-5 flex min-w-0 items-center gap-2 rounded-lg bg-muted/35 px-3 py-2.5">
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[10.5px] text-foreground">
              {collection.clients.length
                ? collection.clients.slice(0, 2).join(", ")
                : "Client details pending"}
              {collection.clients.length > 2
                ? ` +${collection.clients.length - 2}`
                : ""}
            </span>
          </span>
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-5">
        <span className="text-[9.5px] text-muted-foreground">
          Updated {formatDate(collection.latestAt)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExport}
          disabled={exporting}
          className="h-8 px-2.5 text-[10.5px]"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Export
        </Button>
      </div>
    </article>
  );
}

function FilePreview({
  file,
  open,
  onOpenChange,
}: {
  file: WorkspaceFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const contentQuery = useQuery({
    enabled: open && Boolean(file?.id),
    queryKey: ["workspace-file-content", file?.id],
    queryFn: () => getWorkspaceFileContent(file!.id),
    staleTime: 60_000,
  });
  const data = contentQuery.data?.url || contentQuery.data?.contentData;
  // A modal left open past the link lifetime gets one silent refresh.
  const [retriedLink, setRetriedLink] = useState(false);
  const retryExpiredLink = () => {
    if (retriedLink) return;
    setRetriedLink(true);
    void contentQuery.refetch();
  };
  useEffect(() => {
    if (!open) setRetriedLink(false);
  }, [open]);
  const downloadMutation = useMutation({
    // The link is re-issued on click so a modal that has been open past the
    // link lifetime still downloads instead of failing.
    mutationFn: async () => {
      const fresh = await getWorkspaceFileContent(file!.id);
      await downloadStoredFile(
        fresh.downloadUrl || fresh.url || fresh.contentData,
        fresh.file.name || file!.name,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "This file could not be downloaded.",
      ),
  });
  const download = () => {
    if (!file || !data || downloadMutation.isPending) return;
    downloadMutation.mutate();
  };
  const openInNewTab = () => {
    if (!data) return;
    window.open(data, "_blank", "noopener,noreferrer");
  };
  const image = file?.mimeType.startsWith("image/");
  const frame =
    file?.mimeType === "application/pdf" ||
    file?.mimeType === "text/html" ||
    file?.mimeType.startsWith("text/");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[900px] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px]">
                {file?.name || "File preview"}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-[11px]">
                {file
                  ? `${formatBytes(file.sizeBytes)} · ${sourceNames[file.sourceType]}`
                  : ""}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openInNewTab}
                disabled={!data}
                aria-label="Open file in a new tab"
                title="Open in a new tab"
                className="h-8 w-8"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={download}
                disabled={!data || downloadMutation.isPending}
              >
                {downloadMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="dashboard-scroll min-h-[360px] overflow-y-auto bg-muted/35 p-4 sm:min-h-[520px]">
          {contentQuery.isLoading ? (
            <div className="flex h-[460px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : contentQuery.isError ? (
            <div className="flex h-[460px] flex-col items-center justify-center text-center">
              <File className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-[13px] font-medium text-foreground">
                Preview unavailable
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {contentQuery.error instanceof Error
                  ? contentQuery.error.message
                  : "This file could not be loaded."}
              </p>
            </div>
          ) : image && data ? (
            <img
              src={data}
              alt={file?.name || "File preview"}
              onError={retryExpiredLink}
              className="mx-auto max-h-[70dvh] max-w-full rounded-lg object-contain"
            />
          ) : frame && data ? (
            <iframe
              src={data}
              title={file?.name || "File preview"}
              sandbox={file?.mimeType === "text/html" ? "" : undefined}
              className="h-[65dvh] min-h-[460px] w-full rounded-lg border border-border bg-white"
            />
          ) : (
            <div className="flex h-[460px] flex-col items-center justify-center text-center">
              <File className="h-10 w-10 text-muted-foreground" />
              <p className="mt-4 text-[13px] font-medium text-foreground">
                Preview is not available for this file type
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={download}
                  disabled={!data || downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download file
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openInNewTab}
                  disabled={!data}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in a new tab
                </Button>
              </div>
            </div>
          )}
        </div>
        {file && (
          <div className="grid gap-2 border-t border-border px-5 py-3 text-[10px] text-muted-foreground sm:grid-cols-2">
            <span>
              {file.clientName ? `${file.clientName} · ` : ""}
              {file.sourceLabel || sourceNames[file.sourceType]}
            </span>
            <span className="sm:text-right">
              Added {formatDate(file.createdAt)}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileActions({
  file,
  folders,
  onPreview,
  onChanged,
}: {
  file: WorkspaceFile;
  folders: WorkspaceFolder[];
  onPreview: () => void;
  onChanged: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [name, setName] = useState(file.name);
  const [folderId, setFolderId] = useState(file.folderId || "");
  const renameMutation = useMutation({
    mutationFn: () => renameWorkspaceFile(file.id, name),
    onSuccess: () => {
      setRenameOpen(false);
      toast.success("File renamed.");
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Rename failed."),
  });
  const moveMutation = useMutation({
    mutationFn: () => moveWorkspaceFile(file.id, folderId || null),
    onSuccess: () => {
      setMoveOpen(false);
      toast.success("File moved.");
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Move failed."),
  });
  const trashMutation = useMutation({
    mutationFn: () => trashWorkspaceFile(file.id),
    onSuccess: () => {
      toast.success("File moved to Trash.");
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Delete failed."),
  });
  const restoreMutation = useMutation({
    mutationFn: () => restoreWorkspaceFile(file.id),
    onSuccess: () => {
      toast.success("File restored.");
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Restore failed."),
  });
  const shareMutation = useMutation({
    mutationFn: () => shareWorkspaceFile(file.id),
    onSuccess: async (result) => {
      try {
        await navigator.clipboard.writeText(result.url);
        toast.success("Secure share link copied.");
      } catch {
        toast.success(result.url, { duration: 10_000 });
      }
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sharing failed."),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Actions for ${file.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {!file.deletedAt && (
            <>
              <DropdownMenuItem onSelect={onPreview}>
                <File className="h-4 w-4" />
                Preview
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setName(file.name);
                  setRenameOpen(true);
                }}
              >
                <FileText className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setFolderId(file.folderId || "");
                  setMoveOpen(true);
                }}
              >
                <Move className="h-4 w-4" />
                Move
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => shareMutation.mutate()}
                disabled={shareMutation.isPending}
              >
                <Share2 className="h-4 w-4" />
                Copy share link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => trashMutation.mutate()}
                disabled={trashMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Move to Trash
              </DropdownMenuItem>
            </>
          )}
          {file.deletedAt && (
            <DropdownMenuItem
              onSelect={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              <ArchiveRestore className="h-4 w-4" />
              Restore file
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              Change the display name without changing the stored file.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => renameMutation.mutate()}
              disabled={!name.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>Move file</DialogTitle>
            <DialogDescription>
              Choose a folder for {file.name}.
            </DialogDescription>
          </DialogHeader>
          <select
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-[13px] text-foreground outline-hidden focus:ring-2 focus:ring-primary/25"
          >
            <option value="">Home</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMoveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => moveMutation.mutate()}
              disabled={moveMutation.isPending}
            >
              {moveMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Move file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type FileGridItem =
  | { kind: "folder"; item: WorkspaceFolder }
  | { kind: "file"; item: WorkspaceFile };

function FileGridListing({
  displayedFiles,
  folders,
  onChanged,
  onFolderDrop,
  onFolderOpen,
  onPreview,
  onSelectFile,
  resetKey,
  selectedFileIds,
  visibleFolders,
}: {
  displayedFiles: WorkspaceFile[];
  folders: WorkspaceFolder[];
  onChanged: () => void;
  onFolderDrop: (event: DragEvent<HTMLButtonElement>, folderId: string) => void;
  onFolderOpen: (folderId: string) => void;
  onPreview: (file: WorkspaceFile) => void;
  onSelectFile: (fileId: string, selected: boolean) => void;
  resetKey: string;
  selectedFileIds: string[];
  visibleFolders: WorkspaceFolder[];
}) {
  const items: FileGridItem[] = [
    ...visibleFolders.map((item) => ({ kind: "folder" as const, item })),
    ...displayedFiles.map((item) => ({ kind: "file" as const, item })),
  ];

  return (
    <PaginatedCardGrid
      items={items}
      pageSize={12}
      itemLabel="files and folders"
      getKey={(entry) => `${entry.kind}-${entry.item.id}`}
      resetKey={resetKey}
      renderItem={(entry) => {
        if (entry.kind === "folder") {
          return (
            <button
              type="button"
              onClick={() => onFolderOpen(entry.item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onFolderDrop(event, entry.item.id)}
              className="group min-w-0 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Folder className="h-5 w-5" />
              </span>
              <span className="mt-5 block truncate text-[12px] font-semibold text-foreground">
                {entry.item.name}
              </span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Folder
              </span>
            </button>
          );
        }

        const file = entry.item;
        const selected = selectedFileIds.includes(file.id);
        return (
          <div
            draggable={!file.deletedAt}
            onDragStart={(event) =>
              event.dataTransfer.setData(
                "application/x-maxform-file",
                file.id,
              )
            }
            className={cn(
              "group relative min-w-0 rounded-xl border bg-card p-3 transition-colors",
              selected
                ? "border-primary ring-1 ring-primary/15"
                : "border-border hover:border-primary/60",
            )}
          >
            <span className="absolute left-4 top-4 z-10 flex rounded bg-background/90 p-1 shadow-xs">
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) =>
                  onSelectFile(file.id, checked === true)
                }
                aria-label={`Select ${file.name}`}
              />
            </span>
            <button
              type="button"
              onClick={() => {
                if (!file.deletedAt) onPreview(file);
              }}
              className="block w-full text-left"
            >
              <FileCardPreview file={file} className="h-[92px] w-full" />
              <span className="mt-3 block truncate pr-7 text-[12px] font-semibold text-foreground">
                {file.name}
              </span>
              <span className="mt-1 block truncate text-[9.5px] text-muted-foreground">
                {file.clientName ? `${file.clientName} · ` : ""}
                {formatBytes(file.sizeBytes)}
              </span>
            </button>
            <div className="absolute bottom-2.5 right-2">
              <FileActions
                file={file}
                folders={folders}
                onPreview={() => onPreview(file)}
                onChanged={onChanged}
              />
            </div>
          </div>
        );
      }}
    />
  );
}

const externalProviderLabels: Record<ExternalStorageProvider, string> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
};

const externalProviderIcons: Record<ExternalStorageProvider, string> = {
  google_drive: "/images/integrations/google-drive.svg",
  dropbox: "/images/integrations/dropbox.svg",
};

function ExternalProviderLogo({
  provider,
  className,
  alt = "",
}: {
  provider: ExternalStorageProvider;
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={cn("flex items-center justify-center rounded-md bg-muted text-muted-foreground", className)} aria-label={alt || externalProviderLabels[provider]}><Cloud className="h-4 w-4" /></span>;
  }
  return <img src={externalProviderIcons[provider]} alt={alt} className={className} onError={() => setFailed(true)} />;
}

function ExternalStoragePanel({
  userId,
  selectedFileIds,
}: {
  userId?: string;
  selectedFileIds: string[];
}) {
  const externalQuery = useQuery<ExternalStorageWorkspace>({
    enabled: Boolean(userId),
    queryKey: ["external-storage-workspace", userId],
    queryFn: getExternalStorageWorkspace,
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data?.operations.some((operation) => operation.status === "queued" || operation.status === "running") ? 3_000 : false,
  });
  const [connectionId, setConnectionId] = useState("");
  const [driveId, setDriveId] = useState("");
  const [parentId, setParentId] = useState("");
  const [folderTrail, setFolderTrail] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [search, setSearch] = useState("");
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [preserveFolders, setPreserveFolders] = useState(true);
  const [workingProvider, setWorkingProvider] = useState<
    ExternalStorageProvider | null
  >(null);

  const connectedConnections = useMemo(
    () =>
      (externalQuery.data?.connections || []).filter(
        (connection) => connection.status === "connected" && !connection.reconnectRequired,
      ),
    [externalQuery.data?.connections],
  );
  const activeConnection = connectedConnections.find(
    (connection) => connection.id === connectionId,
  ) || connectedConnections[0];
  const provider = activeConnection?.provider;

  useEffect(() => {
    if (!activeConnection) {
      setConnectionId("");
      setDriveId("");
      setParentId("");
      setFolderTrail([]);
      return;
    }
    if (activeConnection.id !== connectionId) {
      setConnectionId(activeConnection.id);
      setDriveId("");
      setParentId("");
      setFolderTrail([]);
    }
  }, [activeConnection, connectionId]);

  const drivesQuery = useQuery({
    enabled: Boolean(activeConnection && provider === "google_drive"),
    queryKey: ["external-storage-drives", activeConnection?.id, provider],
    queryFn: () => listExternalStorageDrives({ connectionId: activeConnection!.id, provider: "google_drive" }),
    staleTime: 60_000,
  });

  const itemsQuery = useQuery({
    enabled: Boolean(activeConnection && provider),
    queryKey: ["external-storage-items", activeConnection?.id, provider, driveId, parentId, search],
    queryFn: () =>
      listExternalStorageItems({
        connectionId: activeConnection!.id,
        provider: provider!,
        parentId,
        driveId,
        search,
      }),
    staleTime: 5_000,
  });

  const refresh = async () => {
    await Promise.all([
      externalQuery.refetch(),
      itemsQuery.refetch(),
      drivesQuery.refetch(),
    ]);
  };

  const connectProvider = async (providerToConnect: ExternalStorageProvider) => {
    setWorkingProvider(providerToConnect);
    try {
      const url = await beginIntegrationConnection(
        providerToConnect === "google_drive" ? "google_workspace" : "dropbox",
        "file.read",
      );
      const popup = openIntegrationPopup(url);
      if (!popup) window.location.assign(url);
      else toast.info(`Finish connecting ${externalProviderLabels[providerToConnect]} in the provider window.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The provider could not be connected.");
    } finally {
      setWorkingProvider(null);
    }
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "maxform:connection-result") return;
      if (event.data.status === "connected") {
        toast.success("External storage connected.");
        void externalQuery.refetch();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [externalQuery]);

  const folderMutation = useMutation({
    mutationFn: () =>
      createExternalStorageFolder({
        connectionId: activeConnection!.id,
        provider: provider!,
        name: folderName,
        parentId,
      }),
    onSuccess: () => {
      setFolderDialogOpen(false);
      setFolderName("");
      toast.success("External folder created.");
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The external folder could not be created."),
  });

  const copyMutation = useMutation({
    mutationFn: () =>
      copyWorkspaceFilesToExternal({
        connectionId: activeConnection!.id,
        provider: provider!,
        targetFolderId: parentId || null,
        preserveFolders,
        ...(selectedFileIds.length ? { fileIds: selectedFileIds } : {}),
      }),
    onSuccess: (result) => {
      setCopyDialogOpen(false);
      toast.success(result.queued
        ? `${result.queued} ${result.queued === 1 ? "file is" : "files are"} being copied to ${externalProviderLabels[result.provider]}.`
        : `${result.succeeded} of ${result.total} ${result.total === 1 ? "file" : "files"} copied to ${externalProviderLabels[result.provider]}.`);
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The files could not be copied externally."),
  });

  const importMutation = useMutation({
    mutationFn: (item: ExternalStorageItem) =>
      importExternalFileToMaxForm({
        connectionId: activeConnection!.id,
        provider: provider!,
        externalFileId: item.id,
      }),
    onSuccess: (result) => {
      if (result.fileId) toast.success("File imported into MaxForm.");
      else toast.error(result.operation.errorMessage || "The file could not be imported.");
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The external file could not be imported."),
  });

  const linkMutation = useMutation({
    mutationFn: (item: ExternalStorageItem) =>
      linkExternalFile({
        connectionId: activeConnection!.id,
        provider: provider!,
        externalFileId: item.id,
      }),
    onSuccess: () => {
      toast.success("External file linked.");
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The external file could not be linked."),
  });

  const retryMutation = useMutation({
    mutationFn: (input: { operationId: string; connectionId?: string | null }) => retryExternalStorageOperation(input),
    onSuccess: () => {
      toast.success("External operation retried.");
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The operation could not be retried."),
  });

  const unlinkMutation = useMutation({
    mutationFn: unlinkExternalFile,
    onSuccess: () => {
      toast.success("External link removed. The MaxForm file was kept.");
      void refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The external link could not be removed."),
  });

  const availableDrives = drivesQuery.data?.drives || [];
  const selectedDrive = availableDrives.find((drive) => drive.id === driveId);
  const resetToRoot = () => {
    setParentId(driveId);
    setFolderTrail(selectedDrive ? [{ id: selectedDrive.id, name: selectedDrive.name }] : []);
  };
  const selectDrive = (value: string) => {
    const drive = availableDrives.find((item) => item.id === value);
    setDriveId(value);
    setParentId(value);
    setFolderTrail(drive ? [{ id: drive.id, name: drive.name }] : []);
  };

  if (externalQuery.isLoading) {
    return <CardGrid>{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[220px] rounded-xl" />)}</CardGrid>;
  }

  if (externalQuery.isError) {
    return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">{externalQuery.error instanceof Error ? externalQuery.error.message : "External storage could not be loaded."}</div>;
  }

  const items = itemsQuery.data?.items || [];
  const remoteFolders = items.filter((item) => item.isFolder);
  const remoteFiles = items.filter((item) => !item.isFolder);
  const linkedCount = externalQuery.data?.links.length || 0;
  const failedOperations = (externalQuery.data?.operations || []).filter((operation) => operation.status === "failed");

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Cloud className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">External storage</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">R2 remains your MaxForm source of truth. Copy the whole library into provider folders, import external files, or keep a safe external reference.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={externalQuery.isFetching || itemsQuery.isFetching}>
              {externalQuery.isFetching || itemsQuery.isFetching ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
              Refresh
            </Button>
            <Button type="button" size="sm" onClick={() => setCopyDialogOpen(true)} disabled={!activeConnection || copyMutation.isPending}>
              {copyMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="mr-2 h-3.5 w-3.5" />}
              {selectedFileIds.length ? `Copy ${selectedFileIds.length} selected` : "Copy all files"}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(["google_drive", "dropbox"] as ExternalStorageProvider[]).map((providerOption) => {
            const account = connectedConnections.find((item) => item.provider === providerOption);
            return (
              <div key={providerOption} className={cn("flex items-center justify-between gap-3 rounded-lg border p-3", account ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20")}>
                <div className="flex min-w-0 items-center gap-3">
                  <ExternalProviderLogo provider={providerOption} alt={`${externalProviderLabels[providerOption]} official logo`} className="h-7 w-7 object-contain" />
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground">{externalProviderLabels[providerOption]}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{account?.accountLabel || "Not connected"}</p></div>
                </div>
                <Button type="button" size="sm" variant={account ? "outline" : "default"} onClick={() => account ? setConnectionId(account.id) : void connectProvider(providerOption)} disabled={workingProvider === providerOption}>
                  {workingProvider === providerOption && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {account ? "Use" : "Connect"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {activeConnection ? (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <ExternalProviderLogo provider={provider!} className="h-7 w-7 object-contain" />
              <div className="min-w-0"><p className="text-sm font-semibold text-foreground">{externalProviderLabels[provider!]}</p><p className="mt-1 text-[11px] text-muted-foreground">Browse folders, import files, or choose this folder as a copy destination.</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={activeConnection.id} onChange={(event) => { setConnectionId(event.target.value); setDriveId(""); setParentId(""); setFolderTrail([]); }} className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground">
                {connectedConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.providerName} · {connection.accountLabel}</option>)}
              </select>
              {provider === "google_drive" && availableDrives.length > 0 && <select value={driveId} onChange={(event) => selectDrive(event.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground" aria-label="Google Drive location">
                <option value="">My Drive</option>
                {availableDrives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
              </select>}
              <Button type="button" variant="outline" size="sm" onClick={() => setFolderDialogOpen(true)}><FolderPlus className="mr-2 h-3.5 w-3.5" />New folder</Button>
              <Button type="button" variant="outline" size="sm" onClick={resetToRoot} disabled={!parentId || parentId === driveId}><ArrowLeft className="mr-2 h-3.5 w-3.5" />Root</Button>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>Location:</span><button type="button" className="font-medium text-foreground hover:text-primary" onClick={resetToRoot}>{selectedDrive?.name || "My Drive"}</button>{folderTrail.filter((folder) => folder.id !== driveId).map((folder) => <span key={folder.id} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /><button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => { const index = folderTrail.findIndex((item) => item.id === folder.id); setFolderTrail(folderTrail.slice(0, index + 1)); setParentId(folder.id); }}>{folder.name}</button></span>)}</div>
            <div className="relative min-w-0 sm:w-[280px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search external files" className="h-9 pl-9 text-xs" /></div>
          </div>

          {itemsQuery.isLoading ? <CardGrid>{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="mt-5 h-[150px] rounded-xl" />)}</CardGrid> : itemsQuery.isError ? <div className="mt-5 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">{itemsQuery.error instanceof Error ? itemsQuery.error.message : "External files could not be loaded."}</div> : (
            <div className="mt-5">
              {remoteFolders.length > 0 && <PaginatedCardGrid items={remoteFolders} pageSize={8} itemLabel="external folders" getKey={(item) => item.id} resetKey={`${activeConnection.id}:${parentId}:${search}:folders`} renderItem={(item) => <div className="flex h-full flex-col rounded-xl border border-border bg-muted/15 p-3"><button type="button" onClick={() => { setParentId(item.id); setFolderTrail([...folderTrail, { id: item.id, name: item.name }]); }} className="flex min-w-0 items-center gap-3 text-left"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Folder className="h-4 w-4" /></span><span className="min-w-0 truncate text-xs font-semibold text-foreground">{item.name}</span></button><p className="mt-auto pt-4 text-[10px] text-muted-foreground">External folder</p></div>} />}
              {remoteFiles.length > 0 && <div className={cn(remoteFolders.length > 0 && "mt-6")}><p className="mb-3 text-xs font-semibold text-foreground">Files</p><PaginatedCardGrid items={remoteFiles} pageSize={8} itemLabel="external files" getKey={(item) => item.id} resetKey={`${activeConnection.id}:${parentId}:${search}:files`} renderItem={(item) => <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3"><div className="flex items-start justify-between gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><File className="h-4 w-4" /></span><button type="button" onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")} className="text-muted-foreground hover:text-foreground" aria-label={`Open ${item.name}`}><ArrowUpRight className="h-4 w-4" /></button></div><p className="mt-3 line-clamp-2 text-xs font-semibold text-foreground">{item.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{item.mimeType}</p><div className="mt-auto flex flex-wrap gap-1.5 pt-4"><Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => importMutation.mutate(item)} disabled={!item.downloadable || importMutation.isPending}><Download className="mr-1 h-3 w-3" />Import</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => linkMutation.mutate(item)} disabled={linkMutation.isPending}><Link2 className="mr-1 h-3 w-3" />Link</Button></div></div>} /></div>}
              {!remoteFolders.length && !remoteFiles.length && <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">No external files or folders found here.</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/15 p-8 text-center"><p className="text-sm font-semibold text-foreground">Connect a storage provider to continue</p><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted-foreground">Provider connections are optional. MaxForm files remain available in R2 until you explicitly copy or import them.</p></div>
      )}


      <Dialog open={folderDialogOpen} onOpenChange={(open) => { if (!folderMutation.isPending) setFolderDialogOpen(open); }}><DialogContent><DialogHeader><DialogTitle>New external folder</DialogTitle><DialogDescription>Create a folder in {provider ? externalProviderLabels[provider] : "external storage"} at the current location.</DialogDescription></DialogHeader><Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Folder name" autoFocus /><DialogFooter><Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>Cancel</Button><Button type="button" onClick={() => folderMutation.mutate()} disabled={!folderName.trim() || folderMutation.isPending}>{folderMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Create folder</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={copyDialogOpen} onOpenChange={(open) => { if (!copyMutation.isPending) setCopyDialogOpen(open); }}><DialogContent><DialogHeader><DialogTitle>{selectedFileIds.length ? `Copy ${selectedFileIds.length} selected files` : "Copy entire MaxForm library"}</DialogTitle><DialogDescription>Files are copied to the current {provider ? externalProviderLabels[provider] : "provider"} folder. MaxForm keeps the internal R2 copy so your modules never depend on the external account.</DialogDescription></DialogHeader><div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">Destination: <span className="font-medium text-foreground">{folderTrail.length ? folderTrail[folderTrail.length - 1].name : "Root"}</span></div><div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-xs font-medium text-foreground">Preserve MaxForm folders</p><p className="mt-1 text-[11px] text-muted-foreground">Create matching folders in the provider before copying files.</p></div><Switch checked={preserveFolders} onCheckedChange={setPreserveFolders} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setCopyDialogOpen(false)}>Cancel</Button><Button type="button" onClick={() => copyMutation.mutate()} disabled={!activeConnection || copyMutation.isPending}>{copyMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Copy files</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function ShieldIcon() {
  return <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"><Cloud className="h-4 w-4" /></span>;
}

export function FilesModule({
  userId,
  initialTab = "all",
  onTabChange,
  projectId = null,
  embedded = false,
}: FilesModuleProps) {
  const [localTab, setLocalTab] = useState<FilesTab>(initialTab);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("");
  const [sourceFilter, setSourceFilter] = useState<FileSource | "">("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const layoutInitialized = useRef(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  const [exportingCollectionId, setExportingCollectionId] = useState<
    string | null
  >(null);
  const [clearScope, setClearScope] = useState<
    "trash" | "manual" | "all" | null
  >(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [bulkConfirmOperation, setBulkConfirmOperation] = useState<
    "trash" | "restore" | null
  >(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const activeTab = onTabChange ? initialTab : localTab;
  const dataView: FilesView =
    activeTab === "storage" || activeTab === "external" || activeTab === "settings"
      ? "all"
      : activeTab;

  const queryKey = fileQueryKey(
    userId || "anonymous",
    dataView,
    currentFolderId,
    deferredSearch,
    typeFilter,
    sourceFilter,
    projectId,
  );
  const workspaceQuery = useQuery({
    enabled: Boolean(userId),
    queryKey,
    queryFn: () =>
      getFilesWorkspace({
        view: dataView,
        folderId: currentFolderId,
        search: deferredSearch,
        type: typeFilter,
        source: sourceFilter,
        projectId,
      }),
    staleTime: 15_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["workspace-files", userId] });

  const uploadMutation = useMutation({
    mutationFn: (file: globalThis.File) =>
      uploadWorkspaceFile(file, currentFolderId),
    onSuccess: () => {
      toast.success("File uploaded.");
      void refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Upload failed."),
  });
  const folderMutation = useMutation({
    mutationFn: () =>
      createWorkspaceFolder({
        name: folderName,
        parentId: currentFolderId,
      }),
    onSuccess: () => {
      setFolderDialogOpen(false);
      setFolderName("");
      toast.success("Folder created.");
      void refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Folder could not be created.",
      ),
  });
  const moveMutation = useMutation({
    mutationFn: ({
      fileId,
      folderId,
    }: {
      fileId: string;
      folderId: string;
    }) => moveWorkspaceFile(fileId, folderId),
    onSuccess: () => {
      toast.success("File moved.");
      void refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Move failed."),
  });
  const clearStorageMutation = useMutation({
    mutationFn: (scope: "trash" | "manual" | "all") =>
      clearWorkspaceStorage(scope),
    onSuccess: (result) => {
      setClearScope(null);
      toast.success(
        result.affected
          ? result.permanent
            ? `${result.affected} ${result.affected === 1 ? "file" : "files"} permanently removed.`
            : `${result.affected} ${result.affected === 1 ? "file" : "files"} moved to Trash.`
          : "There was nothing to clear.",
      );
      void refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Storage could not be cleared.",
      ),
  });
  const settingsMutation = useMutation({
    mutationFn: saveFileSettings,
    onSuccess: (result) => {
      setLayout(result.settings.defaultView);
      toast.success("File settings saved.");
      void refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Settings could not be saved.",
      ),
  });
  const bulkMutation = useMutation({
    mutationFn: (input: {
      operation: "move" | "trash" | "restore";
      folderId?: string | null;
    }) =>
      bulkUpdateWorkspaceFiles({
        ids: selectedFileIds,
        operation: input.operation,
        folderId: input.folderId,
      }),
    onSuccess: (result) => {
      setSelectedFileIds([]);
      setBulkMoveOpen(false);
      setBulkConfirmOperation(null);
      toast.success(
        `${result.affected} ${result.affected === 1 ? "file" : "files"} ${
          result.operation === "move"
            ? "moved"
            : result.operation === "restore"
              ? "restored"
              : "moved to Trash"
        }.`,
      );
      void refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Bulk action failed.",
      ),
  });
  const bulkExportMutation = useMutation({
    mutationFn: () => exportWorkspaceFileSelection(selectedFileIds),
    onSuccess: () =>
      toast.success(
        `${selectedFileIds.length} ${selectedFileIds.length === 1 ? "file" : "files"} exported.`,
      ),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Selected files could not be exported.",
      ),
  });

  const workspace = workspaceQuery.data;
  const folders = useMemo(
    () => workspace?.folders || [],
    [workspace?.folders],
  );
  useEffect(() => {
    if (!workspace?.settings || layoutInitialized.current) return;
    layoutInitialized.current = true;
    setLayout(workspace.settings.defaultView);
  }, [workspace?.settings]);
  const visibleFolders = useMemo(
    () =>
      activeTab === "all" && !deferredSearch
        ? folders.filter((folder) => folder.parentId === currentFolderId)
        : [],
    [activeTab, currentFolderId, deferredSearch, folders],
  );
  const breadcrumb = useMemo(() => {
    const chain: WorkspaceFolder[] = [];
    let id = currentFolderId;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const folder = folders.find((item) => item.id === id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId;
    }
    return chain;
  }, [currentFolderId, folders]);
  const selectedCollection = useMemo(
    () =>
      workspace?.collections.find(
        (collection) => collection.id === selectedCollectionId,
      ) || null,
    [selectedCollectionId, workspace?.collections],
  );
  const collectionOverview =
    activeTab === "all" &&
    !currentFolderId &&
    !selectedCollection &&
    workspace?.settings.groupBySource !== false;
  const visibleCollectionFiles = useMemo(() => {
    const result = new Map<string, WorkspaceFile[]>();
    if (!collectionOverview || !workspace) return result;
    const normalizedSearch = deferredSearch.toLowerCase();
    for (const collection of workspace.collections) {
      const collectionMatchesSearch =
        !normalizedSearch ||
        collection.name.toLowerCase().includes(normalizedSearch) ||
        collection.clients.some((client) =>
          client.toLowerCase().includes(normalizedSearch),
        );
      const files = collection.files.filter((file) => {
        if (!fileMatchesType(file, typeFilter)) return false;
        return (
          collectionMatchesSearch ||
          file.name.toLowerCase().includes(normalizedSearch) ||
          file.clientName.toLowerCase().includes(normalizedSearch) ||
          file.clientEmail.toLowerCase().includes(normalizedSearch)
        );
      });
      result.set(collection.id, files);
    }
    return result;
  }, [
    collectionOverview,
    deferredSearch,
    typeFilter,
    workspace,
  ]);
  const visibleCollections = useMemo(() => {
    if (!collectionOverview || !workspace) return [];
    return workspace.collections.filter((collection) => {
      const sourceMatches =
        !sourceFilter ||
        (sourceFilter === "form_upload" &&
          collection.sourceType === "form") ||
        (sourceFilter === "event_upload" &&
          collection.sourceType === "event");
      return (
        sourceMatches &&
        Boolean(visibleCollectionFiles.get(collection.id)?.length)
      );
    });
  }, [
    collectionOverview,
    sourceFilter,
    visibleCollectionFiles,
    workspace,
  ]);
  const displayedFiles = useMemo(() => {
    if (!workspace) return [];
    if (selectedCollection) {
      const normalizedSearch = deferredSearch.toLowerCase();
      return selectedCollection.files.filter((file) => {
        const searchMatches =
          !normalizedSearch ||
          file.name.toLowerCase().includes(normalizedSearch) ||
          file.clientName.toLowerCase().includes(normalizedSearch) ||
          file.clientEmail.toLowerCase().includes(normalizedSearch);
        return searchMatches && fileMatchesType(file, typeFilter);
      });
    }
    if (collectionOverview) {
      return workspace.files.filter((file) => !file.collectionId);
    }
    return workspace.files;
  }, [
    collectionOverview,
    deferredSearch,
    selectedCollection,
    typeFilter,
    workspace,
  ]);
  const allKnownFiles = useMemo(() => {
    const files = new Map<string, WorkspaceFile>();
    for (const file of workspace?.files || []) files.set(file.id, file);
    for (const collection of workspace?.collections || []) {
      for (const file of collection.files) files.set(file.id, file);
    }
    return files;
  }, [workspace]);
  const selectedFiles = useMemo(
    () =>
      selectedFileIds
        .map((id) => allKnownFiles.get(id))
        .filter((file): file is WorkspaceFile => Boolean(file)),
    [allKnownFiles, selectedFileIds],
  );
  const visibleSelectableFiles = useMemo(() => {
    const files = new Map<string, WorkspaceFile>();
    if (collectionOverview) {
      for (const collection of visibleCollections) {
        for (const file of visibleCollectionFiles.get(collection.id) || []) {
          files.set(file.id, file);
        }
      }
    }
    for (const file of displayedFiles) files.set(file.id, file);
    return Array.from(files.values());
  }, [
    collectionOverview,
    displayedFiles,
    visibleCollectionFiles,
    visibleCollections,
  ]);
  const allVisibleSelected =
    visibleSelectableFiles.length > 0 &&
    visibleSelectableFiles.every((file) =>
      selectedFileIds.includes(file.id),
    );
  const visibleSelectedCount = visibleSelectableFiles.filter((file) =>
    selectedFileIds.includes(file.id),
  ).length;

  const toggleFileSelection = (fileId: string, selected: boolean) => {
    setSelectedFileIds((current) =>
      selected
        ? Array.from(new Set([...current, fileId]))
        : current.filter((id) => id !== fileId),
    );
  };

  const toggleFileSelectionGroup = (
    files: WorkspaceFile[],
    selected: boolean,
  ) => {
    const ids = new Set(files.map((file) => file.id));
    setSelectedFileIds((current) =>
      selected
        ? Array.from(new Set([...current, ...ids]))
        : current.filter((id) => !ids.has(id)),
    );
  };

  const selectTab = (tab: FilesTab) => {
    setLocalTab(tab);
    setCurrentFolderId(null);
    setSearch("");
    setTypeFilter("");
    setSourceFilter("");
    setSelectedCollectionId(null);
    if (tab !== "external") setSelectedFileIds([]);
    onTabChange?.(tab);
  };

  const exportCollection = async (collection: WorkspaceFileCollection) => {
    setExportingCollectionId(collection.id);
    try {
      await exportWorkspaceCollection(
        collection.sourceType,
        collection.sourceId,
        collection.name,
      );
      toast.success(`${collection.name} exported.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Export could not be created.",
      );
    } finally {
      setExportingCollectionId(null);
    }
  };

  const handleUpload = (file?: globalThis.File) => {
    if (file) uploadMutation.mutate(file);
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const onFolderDrop = (
    event: DragEvent<HTMLButtonElement>,
    folderId: string,
  ) => {
    event.preventDefault();
    const fileId = event.dataTransfer.getData("application/x-maxform-file");
    if (fileId) moveMutation.mutate({ fileId, folderId });
  };

  const tabs: Array<{
    key: FilesTab;
    label: string;
    icon: typeof Files;
    count?: number;
  }> = [
    {
      key: "all",
      label: "All files",
      icon: Files,
      count: workspace?.counts.active,
    },
    {
      key: "shared",
      label: "Shared with me",
      icon: Share2,
      count: workspace?.counts.shared,
    },
    {
      key: "trash",
      label: "Trash",
      icon: Trash2,
      count: workspace?.counts.trash,
    },
    { key: "storage", label: "Storage", icon: HardDrive },
    { key: "external", label: "External", icon: Cloud },
    { key: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        {/* Inside a project the page already carries a title and tabs. */}
        <div>
          {embedded ? null : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                Workspace library
              </p>
              <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-foreground sm:text-[38px]">
                Files
              </h1>
              <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-muted-foreground">
                Every upload, signed document, and workspace asset with its
                source attached.
              </p>
            </>
          )}
        </div>
        {activeTab !== "trash" &&
          activeTab !== "storage" &&
          activeTab !== "external" &&
          activeTab !== "settings" && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFolderDialogOpen(true)}
              className="flex-1 sm:flex-none"
            >
              <FolderPlus className="h-4 w-4" />
              New folder
            </Button>
            <Button
              type="button"
              onClick={() => uploadRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
            </Button>
          </div>
        )}
        <input
          ref={uploadRef}
          type="file"
          className="hidden"
          onChange={(event) => handleUpload(event.target.files?.[0])}
        />
      </div>

      <nav
        aria-label="Files views"
        className={cn(
          "dashboard-scroll dashboard-scroll-x mt-7 flex gap-1 overflow-x-auto border-b border-border",
          embedded && "hidden",
        )}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab.key)}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[12px] transition-colors sm:px-4",
                active
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {typeof tab.count === "number" && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                  {tab.count}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] bg-primary" />
              )}
            </button>
          );
        })}
      </nav>

      {activeTab === "external" ? (
        <ExternalStoragePanel userId={userId} selectedFileIds={selectedFileIds} />
      ) : activeTab === "storage" ? (
        <div className="mt-6">
          {workspaceQuery.isLoading ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Skeleton className="h-[230px] rounded-xl" />
              <Skeleton className="h-[230px] rounded-xl" />
            </div>
          ) : workspaceQuery.isError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">
              {workspaceQuery.error instanceof Error
                ? workspaceQuery.error.message
                : "Storage usage could not be loaded."}
            </div>
          ) : workspace ? (
            <StoragePanel
              {...workspace.usage}
              trashCount={workspace.counts.trash}
              onClear={setClearScope}
            />
          ) : null}
        </div>
      ) : activeTab === "settings" ? (
        <div className="mt-6">
          {workspaceQuery.isLoading ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Skeleton className="h-[420px] rounded-xl" />
              <Skeleton className="h-[300px] rounded-xl" />
            </div>
          ) : workspaceQuery.isError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">
              {workspaceQuery.error instanceof Error
                ? workspaceQuery.error.message
                : "File settings could not be loaded."}
            </div>
          ) : workspace ? (
            <FileSettingsPanel
              settings={workspace.settings}
              saving={settingsMutation.isPending}
              onSave={(settings) => settingsMutation.mutate(settings)}
            />
          ) : null}
        </div>
      ) : (
        <>
          <TableFilterBar className="mt-5 lg:flex-row">
            <TableSearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search files, sources, or tags"
              aria-label="Search files"
            />
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex">
              <TableFilterSelect
                value={typeFilter || "all"}
                onValueChange={(value) =>
                  setTypeFilter(
                    value === "all" ? "" : (value as FileTypeFilter),
                  )
                }
                label="Filter by file type"
                className="w-full sm:w-[160px]"
                options={[
                  { value: "all", label: "All types" },
                  { value: "signature", label: "Signatures" },
                  { value: "image", label: "Images" },
                  { value: "pdf", label: "PDF" },
                  { value: "document", label: "Documents" },
                  { value: "video", label: "Video" },
                  { value: "other", label: "Other" },
                ]}
              />
              <TableFilterSelect
                value={sourceFilter || "all"}
                onValueChange={(value) =>
                  setSourceFilter(
                    value === "all" ? "" : (value as FileSource),
                  )
                }
                label="Filter by source"
                className="w-full sm:w-[160px]"
                options={[
                  { value: "all", label: "All sources" },
                  { value: "form_upload", label: "Forms" },
                  { value: "event_upload", label: "Events" },
                  { value: "document", label: "Documents" },
                  { value: "manual", label: "Manual" },
                  { value: "import", label: "Imports" },
                ]}
              />
            </div>
            <div className="flex justify-end sm:justify-start">
              <div className="flex h-10 rounded-md border border-border p-1">
                <button
                  type="button"
                  onClick={() => setLayout("grid")}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded",
                    layout === "grid"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                  aria-label="Grid view"
                >
                  <Grid2X2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setLayout("list")}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded",
                    layout === "list"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                  aria-label="List view"
                >
                  <LayoutList className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </TableFilterBar>

          {visibleSelectableFiles.length > 0 && (
            <div
              className={cn(
                "mt-3 flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                selectedFileIds.length
                  ? "border-primary/35 bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Checkbox
                  checked={
                    visibleSelectedCount > 0 && !allVisibleSelected
                      ? "indeterminate"
                      : allVisibleSelected
                  }
                  onCheckedChange={(checked) =>
                    toggleFileSelectionGroup(
                      visibleSelectableFiles,
                      checked === true,
                    )
                  }
                  aria-label="Select all visible files"
                />
                <span className="text-[11px] text-foreground">
                  {selectedFileIds.length
                    ? `${selectedFileIds.length} selected`
                    : `Select all ${visibleSelectableFiles.length} visible files`}
                </span>
                {selectedFileIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedFileIds([])}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>

              {selectedFileIds.length > 0 && (
                <div className="dashboard-scroll dashboard-scroll-x flex gap-2 overflow-x-auto">
                  {activeTab !== "trash" && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => bulkExportMutation.mutate()}
                        disabled={bulkExportMutation.isPending}
                        className="shrink-0"
                      >
                        {bulkExportMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Download ZIP
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBulkFolderId("");
                          setBulkMoveOpen(true);
                        }}
                        className="shrink-0"
                      >
                        <Move className="h-3.5 w-3.5" />
                        Move
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setBulkConfirmOperation("trash")}
                        className="shrink-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Trash
                      </Button>
                    </>
                  )}
                  {activeTab === "trash" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        bulkMutation.mutate({ operation: "restore" })
                      }
                      disabled={bulkMutation.isPending}
                      className="shrink-0"
                    >
                      {bulkMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      )}
                      Restore
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "all" && selectedCollection && (
            <div className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedCollectionId(null)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Back to source collections"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-foreground">
                      {selectedCollection.name}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {selectedCollection.fileCount} files ·{" "}
                      {selectedCollection.submissionCount} submissions ·{" "}
                      {formatBytes(selectedCollection.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void exportCollection(selectedCollection)}
                  disabled={exportingCollectionId === selectedCollection.id}
                >
                  {exportingCollectionId === selectedCollection.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Export all files
                </Button>
              </div>
            </div>
          )}

          {activeTab === "all" && !selectedCollection && (
            <div className="mt-4 flex min-h-8 items-center gap-1 overflow-x-auto text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setCurrentFolderId(null)}
                className={cn(
                  "shrink-0 rounded px-1.5 py-1 hover:bg-accent hover:text-foreground",
                  !currentFolderId && "font-medium text-foreground",
                )}
              >
                Home
              </button>
              {breadcrumb.map((folder) => (
                <span key={folder.id} className="flex shrink-0 items-center">
                  <ChevronRight className="h-3 w-3" />
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(folder.id)}
                    className={cn(
                      "rounded px-1.5 py-1 hover:bg-accent hover:text-foreground",
                      currentFolderId === folder.id &&
                        "font-medium text-foreground",
                    )}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {collectionOverview && workspace && visibleCollections.length > 0 && (
            <section className="mt-5" aria-label="Files grouped by source">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-[13px] font-semibold text-foreground">
                    Forms & events
                  </h2>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    Submission files grouped by where they came from.
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {visibleCollections.length}{" "}
                  {visibleCollections.length === 1
                    ? "collection"
                    : "collections"}
                </span>
              </div>
              <PaginatedCardGrid
                items={visibleCollections}
                pageSize={12}
                itemLabel="file collections"
                getKey={(collection) => collection.id}
                resetKey={`${deferredSearch}:${sourceFilter}:${typeFilter}`}
                renderItem={(collection) => (
                  <SourceCollectionCard
                    collection={collection}
                    visibleFiles={
                      visibleCollectionFiles.get(collection.id) || []
                    }
                    exporting={exportingCollectionId === collection.id}
                    selectedCount={(
                      visibleCollectionFiles.get(collection.id) || []
                    ).filter((file) =>
                      selectedFileIds.includes(file.id),
                    ).length}
                    onOpen={() => {
                      setCurrentFolderId(null);
                      setSelectedCollectionId(collection.id);
                    }}
                    onExport={() => void exportCollection(collection)}
                    onToggleSelection={(selected) =>
                      toggleFileSelectionGroup(
                        visibleCollectionFiles.get(collection.id) || [],
                        selected,
                      )
                    }
                  />
                )}
              />
            </section>
          )}

          {collectionOverview &&
            workspace &&
            (visibleFolders.length > 0 || displayedFiles.length > 0) && (
              <div className="mt-7">
                <h2 className="text-[13px] font-semibold text-foreground">
                  Workspace uploads
                </h2>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  Folders, manual uploads, documents, and imported files.
                </p>
              </div>
            )}

          <div className="mt-4">
            {workspaceQuery.isLoading ? (
              <CardGrid>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => (
                  <Skeleton key={item} className="h-[165px] rounded-xl" />
                ))}
              </CardGrid>
            ) : workspaceQuery.isError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">
                {workspaceQuery.error instanceof Error
                  ? workspaceQuery.error.message
                  : "Files could not be loaded."}
              </div>
            ) : workspace &&
              (visibleFolders.length || displayedFiles.length) ? (
              layout === "grid" ? (
                <FileGridListing
                  displayedFiles={displayedFiles}
                  folders={folders}
                  onChanged={() => void refresh()}
                  onFolderDrop={onFolderDrop}
                  onFolderOpen={setCurrentFolderId}
                  onPreview={setPreviewFile}
                  onSelectFile={toggleFileSelection}
                  resetKey={`${currentFolderId}:${deferredSearch}:${typeFilter}:${sourceFilter}`}
                  selectedFileIds={selectedFileIds}
                  visibleFolders={visibleFolders}
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="hidden grid-cols-[32px_minmax(0,1fr)_150px_115px_110px_44px] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:grid">
                    <Checkbox
                      checked={
                        displayedFiles.some((file) =>
                          selectedFileIds.includes(file.id),
                        ) &&
                        !displayedFiles.every((file) =>
                          selectedFileIds.includes(file.id),
                        )
                          ? "indeterminate"
                          : displayedFiles.length > 0 &&
                            displayedFiles.every((file) =>
                              selectedFileIds.includes(file.id),
                            )
                      }
                      onCheckedChange={(checked) =>
                        toggleFileSelectionGroup(
                          displayedFiles,
                          checked === true,
                        )
                      }
                      aria-label="Select all files in this list"
                    />
                    <span>Name</span>
                    <span>Client</span>
                    <span>Source</span>
                    <span>Added</span>
                    <span />
                  </div>
                  {visibleFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setCurrentFolderId(folder.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onFolderDrop(event, folder.id)}
                      className="grid w-full grid-cols-[32px_minmax(0,1fr)_44px] items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent/35 sm:grid-cols-[32px_minmax(0,1fr)_150px_115px_110px_44px]"
                    >
                      <span />
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Folder className="h-4 w-4" />
                        </span>
                        <span className="truncate text-[12px] font-medium text-foreground">
                          {folder.name}
                        </span>
                      </span>
                      <span className="hidden text-[11px] text-muted-foreground sm:block">
                        Not applicable
                      </span>
                      <span className="hidden text-[11px] text-muted-foreground sm:block">
                        Folder
                      </span>
                      <span className="hidden text-[11px] text-muted-foreground sm:block">
                        {formatDate(folder.createdAt)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                  {displayedFiles.map((file) => {
                    const selected = selectedFileIds.includes(file.id);
                    return (
                      <div
                        key={file.id}
                        draggable={!file.deletedAt}
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            "application/x-maxform-file",
                            file.id,
                          )
                        }
                        className={cn(
                          "grid grid-cols-[32px_minmax(0,1fr)_44px] items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[32px_minmax(0,1fr)_150px_115px_110px_44px]",
                          selected ? "bg-primary/5" : "hover:bg-accent/35",
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={(checked) =>
                            toggleFileSelection(file.id, checked === true)
                          }
                          aria-label={`Select ${file.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!file.deletedAt) setPreviewFile(file);
                          }}
                          className="flex min-w-0 items-center gap-3 text-left"
                        >
                          <FileCardPreview
                            file={file}
                            className="h-9 w-9 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium text-foreground">
                              {file.name}
                            </span>
                            <span className="mt-0.5 block text-[9.5px] text-muted-foreground sm:hidden">
                              {file.clientName
                                ? `${file.clientName} · `
                                : ""}
                              {formatBytes(file.sizeBytes)}
                            </span>
                          </span>
                        </button>
                        <span className="hidden truncate text-[11px] text-foreground sm:block">
                          {file.clientName || "Not provided"}
                        </span>
                        <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                          {sourceNames[file.sourceType]}
                        </span>
                        <span className="hidden text-[11px] text-muted-foreground sm:block">
                          {formatDate(file.createdAt)}
                        </span>
                        <FileActions
                          file={file}
                          folders={folders}
                          onPreview={() => setPreviewFile(file)}
                          onChanged={() => void refresh()}
                        />
                      </div>
                    );
                  })}
                </div>
              )
            ) : visibleCollections.length ? null : (
              <EmptyState
                view={activeTab}
                onUpload={() => uploadRef.current?.click()}
              />
            )}
          </div>
        </>
      )}

      <Dialog
        open={bulkMoveOpen}
        onOpenChange={(open) => {
          if (!bulkMutation.isPending) setBulkMoveOpen(open);
        }}
      >
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>
              Move {selectedFiles.length} selected{" "}
              {selectedFiles.length === 1 ? "file" : "files"}
            </DialogTitle>
            <DialogDescription>
              Choose the folder where the selected files should appear.
              Their original form, event, and client links remain attached.
            </DialogDescription>
          </DialogHeader>
          <select
            value={bulkFolderId}
            onChange={(event) => setBulkFolderId(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-[13px] text-foreground outline-hidden focus:ring-2 focus:ring-primary/25"
          >
            <option value="">Home</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkMoveOpen(false)}
              disabled={bulkMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                bulkMutation.mutate({
                  operation: "move",
                  folderId: bulkFolderId || null,
                })
              }
              disabled={!selectedFiles.length || bulkMutation.isPending}
            >
              {bulkMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Move files
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkConfirmOperation === "trash"}
        onOpenChange={(open) => {
          if (!open && !bulkMutation.isPending) {
            setBulkConfirmOperation(null);
          }
        }}
      >
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>
              Move {selectedFiles.length} selected{" "}
              {selectedFiles.length === 1 ? "file" : "files"} to Trash?
            </DialogTitle>
            <DialogDescription>
              The files remain recoverable for your selected retention period.
              Source and client information will be preserved if you restore
              them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkConfirmOperation(null)}
              disabled={bulkMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => bulkMutation.mutate({ operation: "trash" })}
              disabled={!selectedFiles.length || bulkMutation.isPending}
            >
              {bulkMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(clearScope)}
        onOpenChange={(open) => {
          if (!open && !clearStorageMutation.isPending) setClearScope(null);
        }}
      >
        <DialogContent className="max-w-[450px]">
          <DialogHeader>
            <DialogTitle>
              {clearScope === "trash"
                ? "Permanently empty Trash?"
                : clearScope === "all"
                  ? "Move every file to Trash?"
                  : "Clear manual uploads?"}
            </DialogTitle>
            <DialogDescription>
              {clearScope === "trash"
                ? "This permanently removes every file currently in Trash. This action cannot be undone."
                : clearScope === "all"
                  ? "All active files will move to Trash and remain recoverable until the retention period ends or Trash is emptied."
                  : "Manual uploads will move to Trash. Submission files, event files, and signed documents will stay in place."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearScope(null)}
              disabled={clearStorageMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={clearScope === "trash" ? "destructive" : "default"}
              onClick={() => {
                if (clearScope) clearStorageMutation.mutate(clearScope);
              }}
              disabled={!clearScope || clearStorageMutation.isPending}
            >
              {clearStorageMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {clearScope === "trash" ? "Empty Trash" : "Move to Trash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription>
              Organize files without losing their original source links.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Folder name"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && folderName.trim()) {
                folderMutation.mutate();
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFolderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => folderMutation.mutate()}
              disabled={!folderName.trim() || folderMutation.isPending}
            >
              {folderMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FilePreview
        file={previewFile}
        open={Boolean(previewFile)}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      />
    </div>
  );
}
