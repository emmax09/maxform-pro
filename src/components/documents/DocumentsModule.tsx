import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  FilePlus2,
  FileSignature,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  TableFilterBar,
  TableFilterSelect,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { CardGrid, PaginatedCardGrid } from "@/components/shared/CardGrid";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkspaceDocument,
  downloadStoredFile,
  getDocumentsWorkspace,
  getWorkspaceFileContent,
  remindWorkspaceDocument,
  saveDocumentSettings,
  saveDocumentTemplate,
  sendWorkspaceDocument,
  uploadWorkspaceFile,
  voidWorkspaceDocument,
  type DocumentSettings,
  type DocumentTemplate,
  type WorkspaceDocument,
} from "@/lib/files-documents";
import { cn } from "@/lib/utils";
import { useTableSelection } from "@/hooks/use-table-selection";

export type DocumentsTab = "templates" | "sent" | "settings";

type DocumentsModuleProps = {
  userId?: string;
  initialTab?: DocumentsTab;
  onTabChange?: (tab: DocumentsTab) => void;
};

type RecipientDraft = {
  id: string;
  role: "signer" | "approver" | "cc";
  name: string;
  email: string;
};

const statusStyles: Record<
  WorkspaceDocument["status"],
  { label: string; className: string }
> = {
  completed: {
    label: "Completed",
    className:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  declined: {
    label: "Declined",
    className:
      "border-destructive/20 bg-destructive/10 text-destructive",
  },
  draft: {
    label: "Draft",
    className: "border-border bg-muted text-muted-foreground",
  },
  expired: {
    label: "Expired",
    className: "border-border bg-muted text-muted-foreground",
  },
  partially_signed: {
    label: "Partially signed",
    className:
      "border-primary/20 bg-primary/10 text-primary",
  },
  sent: {
    label: "Sent",
    className:
      "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  viewed: {
    label: "Viewed",
    className:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  voided: {
    label: "Voided",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const roleNames = {
  approver: "Approver",
  cc: "CC recipient",
  signer: "Signer",
};

const eventNames: Record<string, string> = {
  approved: "Approval completed",
  completed: "Document completed",
  created: "Document created",
  declined: "Document declined",
  reminded: "Reminder sent",
  sent: "Signature request sent",
  signed: "Signature completed",
  viewed: "Document viewed",
  voided: "Document voided",
};

const formatDate = (value: string | null, includeTime = false) => {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: includeTime ? "numeric" : undefined,
    minute: includeTime ? "2-digit" : undefined,
    month: "short",
    year: "numeric",
  }).format(date);
};

const newRecipient = (
  role: RecipientDraft["role"] = "signer",
): RecipientDraft => ({
  id: crypto.randomUUID(),
  email: "",
  name: "",
  role,
});

function StatusBadge({ status }: { status: WorkspaceDocument["status"] }) {
  const style = statusStyles[status] || statusStyles.draft;
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}

function EmptyDocuments({
  type,
  onAction,
}: {
  type: "templates" | "documents";
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {type === "templates" ? (
          <FilePlus2 className="h-5 w-5" />
        ) : (
          <FileSignature className="h-5 w-5" />
        )}
      </span>
      <h3 className="mt-4 text-[15px] font-semibold text-foreground">
        {type === "templates"
          ? "Create your first template"
          : "No documents have been sent"}
      </h3>
      <p className="mt-1.5 max-w-[380px] text-[12px] leading-5 text-muted-foreground">
        {type === "templates"
          ? "Build an agreement from blocks or upload a PDF, then define who needs to sign or approve it."
          : "Start from a template, assign recipients, and track every signature from one timeline."}
      </p>
      <Button type="button" size="sm" className="mt-5" onClick={onAction}>
        <Plus className="h-4 w-4" />
        {type === "templates" ? "New template" : "Send document"}
      </Button>
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [sourceType, setSourceType] = useState<
    "block_built" | "uploaded_pdf"
  >("block_built");
  const [signingOrder, setSigningOrder] = useState<
    "sequential" | "parallel"
  >("sequential");
  const [roles, setRoles] = useState<RecipientDraft[]>([
    newRecipient("signer"),
  ]);
  const [pdf, setPdf] = useState<File | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let baseFileId: string | null = null;
      if (sourceType === "uploaded_pdf") {
        if (!pdf) throw new Error("Choose a PDF for this template.");
        if (pdf.type !== "application/pdf") {
          throw new Error("Only PDF files can be used as PDF templates.");
        }
        baseFileId = (
          await uploadWorkspaceFile(pdf, null, {
            purpose: "document_template",
          })
        ).file.id;
      }
      return saveDocumentTemplate({
        baseFileId,
        blocks:
          sourceType === "block_built"
            ? [
                { content: name, type: "heading" },
                { content: body || description, type: "paragraph" },
                { content: "Signature", type: "signature" },
              ]
            : [],
        defaultSigningOrder: signingOrder,
        description,
        name,
        signerRoles: roles.map((role, index) => ({
          order: index + 1,
          role: role.role,
        })),
        sourceType,
      });
    },
    onSuccess: () => {
      toast.success("Document template created.");
      onOpenChange(false);
      setName("");
      setDescription("");
      setBody("");
      setPdf(null);
      setRoles([newRecipient("signer")]);
      onSaved();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Template could not be saved.",
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92dvh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create document template</DialogTitle>
          <DialogDescription>
            Start from editable blocks or an existing PDF and define the
            recipient roles.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSourceType("block_built")}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              sourceType === "block_built"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40",
            )}
          >
            <FileText className="h-5 w-5 text-primary" />
            <span className="mt-3 block text-[12px] font-semibold text-foreground">
              Build from blocks
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
              Write a simple reusable agreement.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSourceType("uploaded_pdf")}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              sourceType === "uploaded_pdf"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40",
            )}
          >
            <Upload className="h-5 w-5 text-primary" />
            <span className="mt-3 block text-[12px] font-semibold text-foreground">
              Upload a PDF
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
              Use an existing contract or form.
            </span>
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              Template name
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Service agreement"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              Signing order
            </span>
            <select
              value={signingOrder}
              onChange={(event) =>
                setSigningOrder(
                  event.target.value as "sequential" | "parallel",
                )
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="sequential">Sequential</option>
              <option value="parallel">Parallel</option>
            </select>
          </label>
        </div>

        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-foreground">
            Description
          </span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="When this template should be used"
          />
        </label>

        {sourceType === "block_built" ? (
          <label className="space-y-1.5">
            <span className="flex items-center justify-between gap-3 text-[11px] font-medium text-foreground">
              Agreement body
              <span className="font-normal text-muted-foreground">
                Supports {"{{contact.name}}"} and {"{{order.total}}"}
              </span>
            </span>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="This agreement is between {{workspace.name}} and {{contact.name}}..."
              className="min-h-[130px] resize-y"
            />
          </label>
        ) : (
          <div>
            <input
              ref={pdfRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => setPdf(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              onClick={() => pdfRef.current?.click()}
              className="flex min-h-[96px] w-full items-center gap-4 rounded-xl border border-dashed border-border px-4 text-left transition-colors hover:border-primary"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Upload className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {pdf?.name || "Choose a PDF"}
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  PDF only, up to 8 MB
                </span>
              </span>
            </button>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-foreground">
                Recipient roles
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Define who acts when this template is sent.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRoles((current) => [...current, newRecipient("signer")])
              }
              disabled={roles.length >= 12}
            >
              <Plus className="h-3.5 w-3.5" />
              Add role
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {roles.map((recipient, index) => (
              <div
                key={recipient.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <select
                  value={recipient.role}
                  onChange={(event) =>
                    setRoles((current) =>
                      current.map((item) =>
                        item.id === recipient.id
                          ? {
                              ...item,
                              role: event.target
                                .value as RecipientDraft["role"],
                            }
                          : item,
                      ),
                    )
                  }
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
                >
                  <option value="signer">Signer</option>
                  <option value="approver">Approver</option>
                  <option value="cc">CC recipient</option>
                </select>
                {roles.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRoles((current) =>
                        current.filter((item) => item.id !== recipient.id),
                      )
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Remove recipient role"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={
              !name.trim() ||
              (sourceType === "uploaded_pdf" && !pdf) ||
              mutation.isPending
            }
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Create template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDocumentDialog({
  open,
  onOpenChange,
  templates,
  initialTemplateId,
  defaultOrder,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: DocumentTemplate[];
  initialTemplateId?: string | null;
  defaultOrder: "sequential" | "parallel";
  onSent: () => void;
}) {
  const [templateId, setTemplateId] = useState(initialTemplateId || "");
  const [title, setTitle] = useState("");
  const [signingOrder, setSigningOrder] = useState(defaultOrder);
  const [recipients, setRecipients] = useState<RecipientDraft[]>([
    newRecipient(),
  ]);

  useEffect(() => {
    if (!open) return;
    if (initialTemplateId) setTemplateId(initialTemplateId);
  }, [initialTemplateId, open]);

  useEffect(() => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setSigningOrder(template.defaultSigningOrder);
    setTitle((current) => current || template.name);
    const roles = template.signerRoles?.length
      ? template.signerRoles.map((role) =>
          newRecipient(
            ["signer", "approver", "cc"].includes(role.role)
              ? role.role
              : "signer",
          ),
        )
      : [newRecipient()];
    setRecipients(roles);
  }, [templateId, templates]);

  const mutation = useMutation({
    mutationFn: async (sendNow: boolean) => {
      const result = await createWorkspaceDocument({
        templateId,
        title,
        signingOrder,
        signers: recipients.map(({ email, name, role }) => ({
          email,
          name,
          role,
        })),
      });
      const delivery = sendNow
        ? await sendWorkspaceDocument(result.document.id)
        : null;
      return { sendNow, delivery };
    },
    onSuccess: ({ sendNow, delivery }) => {
      if (delivery?.failed) {
        toast.warning(`Document saved, but ${delivery.failed} notification email${delivery.failed === 1 ? "" : "s"} failed.`);
      } else {
        toast.success(sendNow ? "Document sent." : "Document saved as draft.");
      }
      onOpenChange(false);
      setTitle("");
      setTemplateId("");
      setRecipients([newRecipient()]);
      onSent();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Document could not be sent.",
      ),
  });

  const valid =
    Boolean(templateId && title.trim()) &&
    recipients.length > 0 &&
    recipients.every(
      (recipient) =>
        recipient.name.trim() &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92dvh] max-w-[650px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send a document</DialogTitle>
          <DialogDescription>
            Choose a template, assign real recipients, then send secure signing
            links.
          </DialogDescription>
        </DialogHeader>
        {!templates.length ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <FilePlus2 className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-[13px] font-medium text-foreground">
              Create a template first
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Every signature request starts from a reusable template.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium text-foreground">
                  Template
                </span>
                <select
                  value={templateId}
                  onChange={(event) => {
                    setTitle("");
                    setTemplateId(event.target.value);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground"
                >
                  <option value="">Choose template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium text-foreground">
                  Signing order
                </span>
                <select
                  value={signingOrder}
                  onChange={(event) =>
                    setSigningOrder(
                      event.target.value as "sequential" | "parallel",
                    )
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground"
                >
                  <option value="sequential">Sequential</option>
                  <option value="parallel">Parallel</option>
                </select>
              </label>
            </div>
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium text-foreground">
                Document title
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Service agreement: Client name"
              />
            </label>
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold text-foreground">
                    Recipients
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Signing links expire based on Document settings.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRecipients((current) => [
                      ...current,
                      newRecipient(),
                    ])
                  }
                  disabled={recipients.length >= 12}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              <div className="mt-3 space-y-2.5">
                {recipients.map((recipient, index) => (
                  <div
                    key={recipient.id}
                    className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-[92px_1fr_1.2fr_32px]"
                  >
                    <select
                      value={recipient.role}
                      onChange={(event) =>
                        setRecipients((current) =>
                          current.map((item) =>
                            item.id === recipient.id
                              ? {
                                  ...item,
                                  role: event.target
                                    .value as RecipientDraft["role"],
                                }
                              : item,
                          ),
                        )
                      }
                      className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-[10px] text-foreground"
                      aria-label={`Recipient ${index + 1} role`}
                    >
                      <option value="signer">Signer</option>
                      <option value="approver">Approver</option>
                      <option value="cc">CC</option>
                    </select>
                    <Input
                      value={recipient.name}
                      onChange={(event) =>
                        setRecipients((current) =>
                          current.map((item) =>
                            item.id === recipient.id
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Full name"
                      className="h-9 text-[11px]"
                    />
                    <Input
                      type="email"
                      value={recipient.email}
                      onChange={(event) =>
                        setRecipients((current) =>
                          current.map((item) =>
                            item.id === recipient.id
                              ? { ...item, email: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="name@example.com"
                      className="h-9 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((current) =>
                          current.filter((item) => item.id !== recipient.id),
                        )
                      }
                      disabled={recipients.length === 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                      aria-label={`Remove recipient ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => mutation.mutate(false)}
            disabled={!valid || mutation.isPending}
          >
            Save draft
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate(true)}
            disabled={!valid || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Create and send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDetail({
  document,
  open,
  onOpenChange,
  onChanged,
}: {
  document: WorkspaceDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const remindMutation = useMutation({
    mutationFn: () => remindWorkspaceDocument(document!.id),
    onSuccess: (result) => {
      if (result.failed) {
        toast.warning(`${result.failed} reminder email${result.failed === 1 ? "" : "s"} could not be sent.`);
      } else {
        toast.success(
          result.delivered
            ? `Reminder sent to ${result.delivered} recipient${result.delivered === 1 ? "" : "s"}.`
            : "No recipient currently needs a reminder.",
        );
      }
      onChanged();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Reminder could not be sent.",
      ),
  });
  const voidMutation = useMutation({
    mutationFn: () => voidWorkspaceDocument(document!.id),
    onSuccess: () => {
      toast.success("Document voided.");
      onOpenChange(false);
      onChanged();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Document could not be voided.",
      ),
  });
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const result = await getWorkspaceFileContent(document!.signedFileId!);
      await downloadStoredFile(
        result.downloadUrl || result.url || result.contentData,
        result.file.name,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Download could not start.",
      ),
  });
  const active =
    document?.status === "sent" ||
    document?.status === "viewed" ||
    document?.status === "partially_signed";
  const voidable =
    document &&
    !["completed", "declined", "expired", "voided"].includes(document.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92dvh] max-w-[760px] overflow-y-auto p-0">
        {document && (
          <>
            <DialogHeader className="border-b border-border px-5 py-5 text-left sm:px-7">
              <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <DialogTitle className="truncate text-[18px]">
                    {document.title}
                  </DialogTitle>
                  <DialogDescription className="mt-1.5">
                    {document.templateName || "Document"} · Created{" "}
                    {formatDate(document.createdAt)}
                  </DialogDescription>
                </div>
                <StatusBadge status={document.status} />
              </div>
            </DialogHeader>

            <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[1fr_0.9fr]">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[12px] font-semibold text-foreground">
                    Recipients
                  </h3>
                  <span className="text-[10px] text-muted-foreground">
                    {document.signingOrder === "parallel"
                      ? "Parallel signing"
                      : "Sequential signing"}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {document.signers.map((signer, index) => (
                    <div
                      key={signer.id}
                      className="flex items-center gap-3 rounded-xl border border-border p-3"
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          signer.status === "signed" ||
                            signer.status === "approved"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {signer.status === "signed" ||
                        signer.status === "approved" ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <span className="text-[11px] font-semibold">
                            {index + 1}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-foreground">
                          {signer.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {signer.email}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[10px] font-medium text-foreground">
                          {roleNames[signer.role]}
                        </span>
                        <span className="mt-0.5 block text-[9px] capitalize text-muted-foreground">
                          {signer.status.replace("_", " ")}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-[12px] font-semibold text-foreground">
                  Activity
                </h3>
                <div className="mt-4 space-y-0">
                  {document.events.map((event, index) => (
                    <div
                      key={event.id}
                      className="relative flex gap-3 pb-5 last:pb-0"
                    >
                      {index < document.events.length - 1 && (
                        <span className="absolute left-[5px] top-3 h-full w-px bg-border" />
                      )}
                      <span className="relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-background bg-primary" />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium text-foreground">
                          {eventNames[event.eventType] || event.eventType}
                        </span>
                        <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                          {event.actorName || "MaxForm"} ·{" "}
                          {formatDate(event.createdAt, true)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {document.documentHash && (
              <div className="mx-5 mb-5 rounded-lg border border-border bg-muted/35 px-3 py-2.5 font-mono text-[9px] leading-4 text-muted-foreground sm:mx-7">
                SHA-256: {document.documentHash}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-7">
              {document.signedFileId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadMutation.mutate()}
                  disabled={downloadMutation.isPending}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download signed copy
                </Button>
              )}
              {active && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => remindMutation.mutate()}
                  disabled={remindMutation.isPending}
                >
                  {remindMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BellRing className="h-3.5 w-3.5" />
                  )}
                  Send reminder
                </Button>
              )}
              {voidable && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => voidMutation.mutate()}
                  disabled={voidMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Void
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: DocumentSettings;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const mutation = useMutation({
    mutationFn: () => saveDocumentSettings(draft),
    onSuccess: () => {
      toast.success("Document settings saved.");
      onSaved();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Settings could not be saved.",
      ),
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
      <section className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Settings2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Signing defaults
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              These values prefill each new template and signature request.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              Signing order
            </span>
            <select
              value={draft.defaultSigningOrder}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  defaultSigningOrder: event.target
                    .value as DocumentSettings["defaultSigningOrder"],
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-[11px] text-foreground"
            >
              <option value="sequential">Sequential</option>
              <option value="parallel">Parallel</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              Remind every
            </span>
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={30}
                value={draft.reminderDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reminderDays: Number(event.target.value),
                  }))
                }
                className="pr-12"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                days
              </span>
            </div>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-foreground">
              Links expire after
            </span>
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={365}
                value={draft.expiryDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    expiryDays: Number(event.target.value),
                  }))
                }
                className="pr-12"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                days
              </span>
            </div>
          </label>
        </div>

        <div className="mt-6 space-y-4 border-t border-border pt-6">
          <label className="flex items-center justify-between gap-5">
            <span>
              <span className="block text-[12px] font-medium text-foreground">
                Workspace branding
              </span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Show your workspace identity on public signing screens.
              </span>
            </span>
            <Switch
              checked={draft.includeWorkspaceBranding}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  includeWorkspaceBranding: checked,
                }))
              }
            />
          </label>
          <label className="flex items-center justify-between gap-5">
            <span>
              <span className="block text-[12px] font-medium text-foreground">
                Identity verification
              </span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Reserve an extra identity check for higher-stakes agreements.
              </span>
            </span>
            <Switch
              checked={draft.identityVerification}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  identityVerification: checked,
                }))
              }
            />
          </label>
        </div>

        <label className="mt-6 block space-y-1.5">
          <span className="text-[11px] font-medium text-foreground">
            Electronic signature disclosure
          </span>
          <Textarea
            value={draft.disclosureText}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                disclosureText: event.target.value,
              }))
            }
            className="min-h-[110px]"
          />
        </label>
        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!draft.disclosureText.trim() || mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save settings
          </Button>
        </div>
      </section>

      <aside className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <h3 className="mt-5 text-[15px] font-semibold text-foreground">
          Built for a clear audit trail
        </h3>
        <div className="mt-5 space-y-4">
          {[
            "Explicit consent is required before signing.",
            "Signer, timestamp, and IP events are recorded.",
            "Completed documents receive a SHA-256 integrity hash.",
            "Final copies and certificates are stored in Files.",
          ].map((item) => (
            <div key={item} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-[11px] leading-5 text-muted-foreground">
                {item}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 border-t border-border pt-5 text-[9.5px] leading-4 text-muted-foreground">
          Electronic-signature requirements vary by jurisdiction and use case.
          Confirm specific compliance requirements with qualified counsel.
        </p>
      </aside>
    </div>
  );
}

export function DocumentsModule({
  userId,
  initialTab = "templates",
  onTabChange,
}: DocumentsModuleProps) {
  const [localTab, setLocalTab] = useState<DocumentsTab>(initialTab);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendTemplateId, setSendTemplateId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] =
    useState<WorkspaceDocument | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const queryClient = useQueryClient();
  const activeTab = onTabChange ? initialTab : localTab;
  const queryKey = ["workspace-documents", userId || "anonymous"];
  const workspaceQuery = useQuery({
    enabled: Boolean(userId),
    queryKey,
    queryFn: getDocumentsWorkspace,
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const workspace = workspaceQuery.data;
  const documents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (workspace?.documents || []).filter(
      (document) =>
        (!status || document.status === status) &&
        (!query ||
          document.title.toLowerCase().includes(query) ||
          document.templateName.toLowerCase().includes(query) ||
          document.signers.some(
            (signer) =>
              signer.name.toLowerCase().includes(query) ||
              signer.email.toLowerCase().includes(query),
          )),
    );
  }, [search, status, workspace?.documents]);
  const selection = useTableSelection(
    documents.map((document) => document.id),
  );
  const selectedDocuments = documents.filter((document) =>
    selection.selectedVisibleIds.includes(document.id),
  );

  const selectTab = (tab: DocumentsTab) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };
  const openSend = (templateId?: string) => {
    setSendTemplateId(templateId || null);
    setSendDialogOpen(true);
  };
  const tabs: Array<{
    key: DocumentsTab;
    label: string;
    icon: typeof FileText;
    count?: number;
  }> = [
    {
      key: "templates",
      label: "Templates",
      icon: FileText,
      count: workspace?.templates.length,
    },
    {
      key: "sent",
      label: "Sent documents",
      icon: Send,
      count: workspace?.counts.total,
    },
    { key: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            E-signature workspace
          </p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.025em] text-foreground sm:text-[38px]">
            Documents
          </h1>
          <p className="mt-2 max-w-[660px] text-[13px] leading-6 text-muted-foreground">
            Prepare agreements, send secure signature requests, and see exactly
            who still needs to act.
          </p>
        </div>
        {activeTab !== "settings" && (
          <div className="flex items-center gap-2">
            {activeTab === "templates" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplateDialogOpen(true)}
                className="flex-1 sm:flex-none"
              >
                <FilePlus2 className="h-4 w-4" />
                New template
              </Button>
            )}
            <Button
              type="button"
              onClick={() => openSend()}
              className="flex-1 sm:flex-none"
            >
              <Send className="h-4 w-4" />
              Send document
            </Button>
          </div>
        )}
      </div>

      <nav
        aria-label="Documents views"
        className="dashboard-scroll dashboard-scroll-x mt-7 flex gap-1 overflow-x-auto border-b border-border"
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
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
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

      {workspaceQuery.isLoading ? (
        <CardGrid className="mt-6">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-[190px] rounded-xl" />
          ))}
        </CardGrid>
      ) : workspaceQuery.isError ? (
        <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">
          {workspaceQuery.error instanceof Error
            ? workspaceQuery.error.message
            : "Documents could not be loaded."}
        </div>
      ) : workspace ? (
        <>
          {activeTab === "templates" &&
            (workspace.templates.length ? (
              <PaginatedCardGrid
                items={workspace.templates}
                pageSize={12}
                itemLabel="document templates"
                getKey={(template) => template.id}
                className="mt-6"
                renderItem={(template) => (
                  <article
                    className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        {template.sourceType === "uploaded_pdf" ? (
                          <FileSignature className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px] font-medium text-muted-foreground"
                      >
                        {template.sourceType === "uploaded_pdf"
                          ? "Uploaded PDF"
                          : "Block built"}
                      </Badge>
                    </div>
                    <h2 className="mt-5 truncate text-[14px] font-semibold text-foreground">
                      {template.name}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 min-h-9 text-[10.5px] leading-[18px] text-muted-foreground">
                      {template.description ||
                        "Reusable document template with secure signing."}
                    </p>
                    <div className="mt-5 flex items-center gap-4 border-t border-border pt-4 text-[9.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3 w-3" />
                        {template.signerRoles.length} role
                        {template.signerRoles.length === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <ArrowRight className="h-3 w-3" />
                        {template.defaultSigningOrder}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full"
                      onClick={() => openSend(template.id)}
                    >
                      Use template
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </article>
                )}
              />
            ) : (
              <div className="mt-6">
                <EmptyDocuments
                  type="templates"
                  onAction={() => setTemplateDialogOpen(true)}
                />
              </div>
            ))}

          {activeTab === "sent" && (
            <div className="mt-6">
              <TableFilterBar>
                <TableSearchField
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search documents or recipients"
                  aria-label="Search documents"
                />
                <TableFilterSelect
                  value={status || "all"}
                  onValueChange={(value) =>
                    setStatus(value === "all" ? "" : value)
                  }
                  label="Filter documents by status"
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "draft", label: "Draft" },
                    { value: "sent", label: "Sent" },
                    { value: "viewed", label: "Viewed" },
                    {
                      value: "partially_signed",
                      label: "Partially signed",
                    },
                    { value: "completed", label: "Completed" },
                    { value: "declined", label: "Declined" },
                    { value: "voided", label: "Voided" },
                    { value: "expired", label: "Expired" },
                  ]}
                />
              </TableFilterBar>
              <TableSelectionBar
                className="mt-3"
                totalCount={documents.length}
                selectedCount={selection.selectedVisibleIds.length}
                allSelected={selection.allSelected}
                partiallySelected={selection.partiallySelected}
                onToggleAll={selection.toggleAll}
                onClear={selection.clearSelection}
                itemLabel="documents"
              >
                {selectedDocuments.some(
                  (document) => document.status === "draft",
                ) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void Promise.all(
                        selectedDocuments
                          .filter((document) => document.status === "draft")
                          .map((document) =>
                            sendWorkspaceDocument(document.id),
                          ),
                      )
                        .then((results) => {
                          const failed = results.reduce((total, result) => total + result.failed, 0);
                          if (failed) {
                            toast.warning(`${failed} notification email${failed === 1 ? "" : "s"} could not be sent.`);
                          } else {
                            toast.success("Selected draft documents sent.");
                          }
                          selection.clearSelection();
                          void refresh();
                        })
                        .catch((error: unknown) =>
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "The selected documents could not be sent.",
                          ),
                        );
                    }}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send drafts
                  </Button>
                ) : null}
                {selectedDocuments.some(
                  (document) => document.signedFileId,
                ) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void Promise.all(
                        selectedDocuments
                          .filter((document) => document.signedFileId)
                          .map(async (document) => {
                            const result = await getWorkspaceFileContent(
                              document.signedFileId!,
                            );
                            const link = window.document.createElement("a");
                            link.href = result.url || result.contentData;
                            link.download = result.file.name;
                            link.click();
                          }),
                      ).catch((error: unknown) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "The selected files could not be downloaded.",
                        ),
                      );
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download signed
                  </Button>
                ) : null}
              </TableSelectionBar>
              {documents.length ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
                  <div className="hidden grid-cols-[36px_minmax(0,1fr)_130px_110px_130px_36px] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:grid">
                    <span />
                    <span>Document</span>
                    <span>Recipients</span>
                    <span>Status</span>
                    <span>Updated</span>
                    <span />
                  </div>
                  {documents.map((document) => {
                    const signed = document.signers.filter((signer) =>
                      ["signed", "approved"].includes(signer.status),
                    ).length;
                    return (
                      <div
                        key={document.id}
                        className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-3 border-b border-border px-4 py-4 last:border-0 hover:bg-accent/30 md:grid-cols-[36px_minmax(0,1fr)_130px_110px_130px_36px]"
                      >
                        <TableRowSelect
                          checked={selection.isSelected(document.id)}
                          onCheckedChange={(checked) =>
                            selection.toggle(document.id, checked)
                          }
                          label={`Select ${document.title}`}
                          className="-ml-2"
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedDocument(document)}
                          className="flex min-w-0 items-center gap-3 text-left"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FileCheck2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-foreground">
                              {document.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[9.5px] text-muted-foreground">
                              {document.templateName || "Document"} ·{" "}
                              {signed}/{document.signers.length} complete
                            </span>
                            <span className="mt-2 block md:hidden">
                              <StatusBadge status={document.status} />
                            </span>
                          </span>
                        </button>
                        <span className="hidden text-[10.5px] text-muted-foreground md:block">
                          {document.signers.length} recipient
                          {document.signers.length === 1 ? "" : "s"}
                        </span>
                        <span className="hidden md:block">
                          <StatusBadge status={document.status} />
                        </span>
                        <span className="hidden text-[10.5px] text-muted-foreground md:block">
                          {formatDate(document.updatedAt)}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={`Actions for ${document.title}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setSelectedDocument(document)}
                            >
                              <FileText className="h-4 w-4" />
                              View details
                            </DropdownMenuItem>
                            {document.status === "draft" && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  void sendWorkspaceDocument(document.id)
                                    .then((result) => {
                                      if (result.failed) {
                                        toast.warning(`${result.failed} notification email${result.failed === 1 ? "" : "s"} could not be sent.`);
                                      } else {
                                        toast.success("Document sent.");
                                      }
                                      void refresh();
                                    })
                                    .catch((error: unknown) =>
                                      toast.error(
                                        error instanceof Error
                                          ? error.message
                                          : "Document could not be sent.",
                                      ),
                                    );
                                }}
                              >
                                <Send className="h-4 w-4" />
                                Send now
                              </DropdownMenuItem>
                            )}
                            {document.signedFileId && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => {
                                    void getWorkspaceFileContent(
                                      document.signedFileId!,
                                    ).then((result) => {
                                      const link =
                                        window.document.createElement("a");
                                      link.href = result.url || result.contentData;
                                      link.download = result.file.name;
                                      link.click();
                                    });
                                  }}
                                >
                                  <Download className="h-4 w-4" />
                                  Download
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              ) : workspace.documents.length ? (
                <div className="mt-4 rounded-xl border border-dashed border-border py-16 text-center">
                  <Search className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 text-[12px] font-medium text-foreground">
                    No matching documents
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStatus("");
                    }}
                    className="mt-2 text-[11px] font-medium text-primary"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyDocuments
                    type="documents"
                    onAction={() => openSend()}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="mt-6">
              <SettingsPanel
                settings={workspace.settings}
                onSaved={() => void refresh()}
              />
            </div>
          )}
        </>
      ) : null}

      <TemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onSaved={() => void refresh()}
      />
      <SendDocumentDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        templates={workspace?.templates || []}
        initialTemplateId={sendTemplateId}
        defaultOrder={
          workspace?.settings.defaultSigningOrder || "sequential"
        }
        onSent={() => void refresh()}
      />
      <DocumentDetail
        document={selectedDocument}
        open={Boolean(selectedDocument)}
        onOpenChange={(open) => {
          if (!open) setSelectedDocument(null);
        }}
        onChanged={() => void refresh()}
      />
    </div>
  );
}
