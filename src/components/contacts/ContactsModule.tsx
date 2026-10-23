import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  ListFilter,
  Loader2,
  MoreHorizontal,
  StickyNote,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tags,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  inferContactImportMapping,
  isContactImportEmail,
  mapContactImportRows,
  parseContactImportFile,
  contactImportTargetOptions,
  isContactImportMetadataHeader,
  type ContactImportMapping,
  type ContactImportRow,
  type ContactImportTarget,
  type ParsedContactImport,
} from "@/lib/contact-import";
import { downloadCsvFile, timestampedCsvFilename } from "@/lib/csv";
import { formatCurrency } from "@/lib/regional-options";
import {
  addContactsToList,
  contactMatchesSegment,
  contactsForList,
  createContact,
  createContactCustomField,
  createContactNote,
  defaultContactCrmSettings,
  deleteContactCustomField,
  deleteContactList,
  deleteContacts,
  getContactCrmSettings,
  importContacts,
  listContactActivity,
  listContactCustomFields,
  listContactLists,
  listContactNotes,
  listContactPayments,
  listContacts,
  mergeContacts,
  removeContactsFromList,
  saveContactCrmSettings,
  saveContactList,
  updateContact,
  updateContactCustomField,
  type ContactActivityRecord,
  type ContactCrmSettings,
  type ContactCustomField,
  type ContactLifecycle,
  type ContactListRecord,
  type ContactNoteRecord,
  type ContactRecord,
  type ContactSegmentRule,
} from "@/lib/contacts";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import { useTablePagination } from "@/hooks/use-table-pagination";
import {
  persistentCacheKey,
  setCachedServerState,
} from "@/lib/performance/indexed-cache";
import { queryKeys } from "@/lib/performance/query-client";
import { cn } from "@/lib/utils";

export type ContactsTab =
  | "contacts"
  | "lists"
  | "segments"
  | "fields"
  | "import"
  | "settings";

type ContactsModuleProps = {
  userId?: string;
  embedded?: boolean;
  initialTab?: ContactsTab;
  showNavigation?: boolean;
};

type ProfileTab = "timeline" | "lists" | "files" | "payments" | "notes";

type ContactDraft = {
  company: string;
  email: string;
  fullName: string;
  lifecycleStage: string;
  phone: string;
  tags: string;
};

type ContactsWorkspaceData = {
  contacts: ContactRecord[];
  crmSettings: ContactCrmSettings;
  fields: ContactCustomField[];
  lists: ContactListRecord[];
};

const emptyContactDraft: ContactDraft = {
  company: "",
  email: "",
  fullName: "",
  lifecycleStage: "lead",
  phone: "",
  tags: "",
};

const contactGridColumns =
  "grid-cols-[48px_minmax(240px,1.6fr)_minmax(150px,0.9fr)_minmax(140px,0.8fr)_minmax(150px,0.9fr)_minmax(170px,1fr)_minmax(120px,0.7fr)_48px]";

const tabs: Array<{
  key: ContactsTab;
  label: string;
  icon: typeof Users;
}> = [
  { key: "contacts", label: "All contacts", icon: Users },
  { key: "lists", label: "Lists", icon: ListFilter },
  { key: "segments", label: "Segments", icon: Filter },
  { key: "fields", label: "Custom fields", icon: Tags },
  { key: "import", label: "Import & export", icon: ArrowDownToLine },
  { key: "settings", label: "Settings", icon: Settings },
];

const profileTabs: Array<{ key: ProfileTab; label: string }> = [
  { key: "timeline", label: "Timeline" },
  { key: "lists", label: "Lists" },
  { key: "files", label: "Files" },
  { key: "payments", label: "Payments" },
  { key: "notes", label: "Notes" },
];

const fieldTypes: ContactCustomField["fieldType"][] = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
];

const initials = (name: string, email: string) =>
  (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";

const titleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value: string | null, includeTime = false) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
};

const lifecycleClasses = (stage: string) => {
  if (stage === "customer")
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (stage === "contacted")
    return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  if (stage === "past_customer")
    return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-border bg-muted/60 text-muted-foreground";
};

const downloadContacts = (contacts: ContactRecord[], fileName: string) => {
  downloadCsvFile(
    fileName,
    ["Email", "Full name", "Phone", "Company", "Lifecycle", "Tags"],
    contacts.map((contact) => [
      contact.email,
      contact.fullName,
      contact.phone,
      contact.company,
      contact.lifecycleStage,
      contact.tags.join(";"),
    ]),
  );
};

function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof Users;
  title: string;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center border-y border-border px-5 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 max-w-[390px] text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function ContactDialog({
  contact,
  lifecycleStages,
  lists,
  onCreateList,
  onOpenChange,
  onSave,
  open,
  working,
}: {
  contact: ContactRecord | null;
  lifecycleStages: string[];
  lists: ContactListRecord[];
  onCreateList: (name: string) => Promise<ContactListRecord | null>;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: ContactDraft, listIds: string[]) => void;
  open: boolean;
  working: boolean;
}) {
  const [draft, setDraft] = useState<ContactDraft>(emptyContactDraft);
  const [creatingList, setCreatingList] = useState(false);
  const [listWorking, setListWorking] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const staticLists = lists.filter((list) => list.listType === "static");

  useEffect(() => {
    if (!open) return;
    setDraft(
      contact
        ? {
            company: contact.company,
            email: contact.email,
            fullName: contact.fullName,
            lifecycleStage: contact.lifecycleStage,
            phone: contact.phone,
            tags: contact.tags.join(", "),
          }
        : emptyContactDraft,
    );
    setCreatingList(false);
    setNewListName("");
    setSelectedListIds(contact?.listIds || []);
  }, [contact, open]);

  const createList = async () => {
    const name = newListName.trim();
    if (!name) return;
    setListWorking(true);
    const created = await onCreateList(name);
    if (created) {
      setSelectedListIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setNewListName("");
      setCreatingList(false);
    }
    setListWorking(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "New contact"}</DialogTitle>
          <DialogDescription>
            {contact
              ? "Update the contact profile."
              : "Add a person to your workspace CRM."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="crm-contact-name">Full name</Label>
            <Input
              id="crm-contact-name"
              value={draft.fullName}
              onChange={(event) =>
                setDraft({ ...draft, fullName: event.target.value })
              }
              placeholder="Ada Lovelace"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-contact-email">Email</Label>
            <Input
              id="crm-contact-email"
              type="email"
              value={draft.email}
              onChange={(event) =>
                setDraft({ ...draft, email: event.target.value })
              }
              placeholder="ada@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-contact-phone">Phone</Label>
            <PhoneInput
              id="crm-contact-phone"
              value={draft.phone}
              onChange={(phone) =>
                setDraft({ ...draft, phone: phone || "" })
              }
              defaultCountry="US"
              placeholder="Enter phone number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-contact-company">Company</Label>
            <Input
              id="crm-contact-company"
              value={draft.company}
              onChange={(event) =>
                setDraft({ ...draft, company: event.target.value })
              }
              placeholder="Company name"
            />
          </div>
          <div className="space-y-2">
            <Label>Lifecycle stage</Label>
            <Select
              value={draft.lifecycleStage}
              onValueChange={(lifecycleStage) =>
                setDraft({ ...draft, lifecycleStage })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lifecycleStages.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {titleCase(stage)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-contact-tags">Tags</Label>
            <Input
              id="crm-contact-tags"
              value={draft.tags}
              onChange={(event) =>
                setDraft({ ...draft, tags: event.target.value })
              }
              placeholder="lead, newsletter"
            />
          </div>
          <div className="space-y-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Lists</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Add this contact to one or more static lists.
                </p>
              </div>
              {staticLists.length > 0 && !creatingList && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreatingList(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New list
                </Button>
              )}
            </div>

            {staticLists.length > 0 && (
              <div className="grid max-h-36 gap-1 overflow-y-auto border-y border-border py-2 sm:grid-cols-2">
                {staticLists.map((list) => {
                  const checked = selectedListIds.includes(list.id);
                  return (
                    <label
                      key={list.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2 px-2 py-2 hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          setSelectedListIds((current) =>
                            nextChecked
                              ? Array.from(new Set([...current, list.id]))
                              : current.filter((id) => id !== list.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                        {list.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {list.memberCount}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {(creatingList || staticLists.length === 0) && (
              <div className="border border-border bg-muted/20 p-3">
                {staticLists.length === 0 && (
                  <p className="mb-3 text-[11px] text-muted-foreground">
                    No lists yet. Create the first one here.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={newListName}
                    onChange={(event) => setNewListName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createList();
                      }
                    }}
                    placeholder="List name"
                    aria-label="New contact list name"
                    autoFocus={creatingList}
                  />
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => void createList()}
                    disabled={listWorking || !newListName.trim()}
                    aria-label="Create contact list"
                  >
                    {listWorking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  {staticLists.length > 0 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setCreatingList(false);
                        setNewListName("");
                      }}
                      aria-label="Cancel new list"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
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
            onClick={() => onSave(draft, selectedListIds)}
            disabled={working || listWorking || !draft.email.trim()}
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            {contact ? "Save contact" : "Create contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactProfile({
  contact,
  lists,
  onChange,
  onEdit,
  onOpenChange,
  open,
  userId,
}: {
  contact: ContactRecord | null;
  lists: ContactListRecord[];
  onChange: () => void;
  onEdit: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  userId: string;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ProfileTab>("timeline");
  const [activity, setActivity] = useState<ContactActivityRecord[]>([]);
  const [notes, setNotes] = useState<ContactNoteRecord[]>([]);
  const [payments, setPayments] = useState<
    Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      formTitle: string;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!contact) return;
    setLoading(true);
    try {
      const [nextActivity, nextNotes, nextPayments] = await Promise.all([
        listContactActivity(userId, contact.id),
        listContactNotes(userId, contact.id),
        listContactPayments(userId, contact.email),
      ]);
      setActivity(nextActivity);
      setNotes(nextNotes);
      setPayments(nextPayments);
    } finally {
      setLoading(false);
    }
  }, [contact, userId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const addNote = async () => {
    if (!contact || !note.trim()) return;
    setWorking(true);
    try {
      const created = await createContactNote(userId, contact.id, note);
      setNotes((current) => [created, ...current]);
      setNote("");
      toast({ title: "Note added" });
      await load();
      onChange();
    } catch (error) {
      toast({
        title: "Note was not added",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const toggleList = async (list: ContactListRecord) => {
    if (!contact || list.listType === "dynamic") return;
    const included = contact.listNames.includes(list.name);
    try {
      if (included) {
        await removeContactsFromList(userId, list.id, [contact.id]);
      } else {
        await addContactsToList(userId, list.id, [contact.id]);
      }
      toast({ title: included ? "Removed from list" : "Added to list" });
      onChange();
    } catch (error) {
      toast({
        title: "List membership was not changed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        {contact && (
          <>
            <SheetHeader className="border-b border-border px-6 pb-5 pt-6 pr-14">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12 border border-border">
                  <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary">
                    {initials(contact.fullName, contact.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-[19px]">
                    {contact.fullName || contact.email}
                  </SheetTitle>
                  <SheetDescription className="mt-1 truncate">
                    {contact.email}
                  </SheetDescription>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded px-2 py-0.5 text-[9px] font-medium",
                        lifecycleClasses(contact.lifecycleStage),
                      )}
                    >
                      {titleCase(contact.lifecycleStage)}
                    </Badge>
                    {contact.unsubscribedAt && (
                      <Badge
                        variant="outline"
                        className="rounded px-2 py-0.5 text-[9px] font-medium text-muted-foreground"
                      >
                        Unsubscribed
                      </Badge>
                    )}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
                <SheetClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Close contact profile"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </SheetClose>
              </div>
            </SheetHeader>

            <div className="grid grid-cols-2 border-b border-border text-[11px] sm:grid-cols-4">
              {[
                ["Phone", contact.phone || "Not set"],
                ["Company", contact.company || "Not set"],
                ["Source", titleCase(contact.sourceType)],
                ["Last activity", formatDate(contact.lastActivityAt)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 border-b border-r border-border px-4 py-3 last:border-r-0 sm:border-b-0"
                >
                  <p className="text-[9px] font-semibold uppercase text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-1 truncate font-medium">{value}</p>
                </div>
              ))}
            </div>

            <nav className="flex overflow-x-auto border-b border-border px-4">
              {profileTabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "relative shrink-0 px-3 py-3 text-[11px] font-medium text-muted-foreground",
                    tab === item.key && "text-foreground",
                  )}
                >
                  {item.label}
                  {tab === item.key && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" />
                  )}
                </button>
              ))}
            </nav>

            <div className="dashboard-scroll h-full min-h-0 overflow-y-auto px-6 py-5">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : tab === "timeline" ? (
                activity.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No activity yet"
                    description="Contact activity will appear here as forms, automations, campaigns, and profile updates occur."
                  />
                ) : (
                  <div className="space-y-0">
                    {activity.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-border py-4 last:border-b-0"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Activity className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[12px] font-medium">{item.title}</p>
                            <span className="shrink-0 text-[9px] text-muted-foreground">
                              {formatDate(item.createdAt, true)}
                            </span>
                          </div>
                          {item.detail && (
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {item.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : tab === "lists" ? (
                lists.length === 0 ? (
                  <EmptyState
                    icon={ListFilter}
                    title="No lists"
                    description="Create a list to organize contacts for forms, automations, and campaigns."
                  />
                ) : (
                  <div className="space-y-2">
                    {lists.map((list) => {
                      const included =
                        list.listType === "dynamic"
                          ? contactMatchesSegment(
                              contact,
                              list.filterDefinition,
                            )
                          : contact.listNames.includes(list.name);
                      return (
                        <div
                          key={list.id}
                          className="flex items-center justify-between gap-4 border-b border-border py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium">
                              {list.name}
                            </p>
                            <p className="mt-1 text-[10px] capitalize text-muted-foreground">
                              {list.listType} list
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant={included ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => void toggleList(list)}
                            disabled={list.listType === "dynamic"}
                          >
                            {included ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {included ? "Included" : "Add"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : tab === "files" ? (
                <EmptyState
                  icon={FileText}
                  title="No submitted files"
                  description="Uploads associated with this contact will be listed here."
                />
              ) : tab === "payments" ? (
                payments.length === 0 ? (
                  <EmptyState
                    icon={CircleDollarSign}
                    title="No payments"
                    description="Payments matched to this contact's email will appear here."
                  />
                ) : (
                  <div>
                    {payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border py-4"
                      >
                        <div>
                          <p className="text-[12px] font-medium">
                            {payment.formTitle || "Form payment"}
                          </p>
                          <p className="mt-1 text-[10px] capitalize text-muted-foreground">
                            {payment.status} · {formatDate(payment.createdAt)}
                          </p>
                        </div>
                        <p className="text-[13px] font-semibold">
                          {formatCurrency(payment.amount, payment.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div>
                  <div className="space-y-3 border-b border-border pb-5">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Add a private note"
                      className="min-h-[92px]"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void addNote()}
                        disabled={working || !note.trim()}
                      >
                        {working ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <StickyNote className="h-3.5 w-3.5" />
                        )}
                        Add note
                      </Button>
                    </div>
                  </div>
                  {notes.map((item) => (
                    <div
                      key={item.id}
                      className="border-b border-border py-4 last:border-b-0"
                    >
                      <p className="whitespace-pre-wrap text-[12px] leading-5">
                        {item.body}
                      </p>
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        {formatDate(item.createdAt, true)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ListDialog({
  editing,
  listType,
  onOpenChange,
  onSave,
  open,
  working,
}: {
  editing: ContactListRecord | null;
  listType: "static" | "dynamic";
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    id?: string;
    name: string;
    description: string;
    filterDefinition: ContactSegmentRule[];
  }) => void;
  open: boolean;
  working: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<ContactSegmentRule[]>([
    { field: "lifecycle_stage", operator: "equals", value: "lead" },
  ]);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name || "");
    setDescription(editing?.description || "");
    setRules(
      editing?.filterDefinition.length
        ? editing.filterDefinition
        : [{ field: "lifecycle_stage", operator: "equals", value: "lead" }],
    );
  }, [editing, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit" : "New"}{" "}
            {listType === "dynamic" ? "segment" : "list"}
          </DialogTitle>
          <DialogDescription>
            {listType === "dynamic"
              ? "Contacts enter and leave automatically as rules match."
              : "Create a static group for forms, automation, and campaigns."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-list-name">Name</Label>
              <Input
                id="crm-list-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  listType === "dynamic" ? "Active customers" : "Newsletter"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-list-description">Description</Label>
              <Input
                id="crm-list-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional internal description"
              />
            </div>
          </div>
          {listType === "dynamic" && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[12px] font-medium">Match all rules</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Segment membership is recalculated from contact data.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRules((current) => [
                      ...current,
                      { field: "tag", operator: "contains", value: "" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add rule
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {rules.map((rule, index) => (
                  <div
                    key={`${index}-${rule.field}`}
                    className="grid gap-2 sm:grid-cols-[150px_150px_minmax(0,1fr)_36px]"
                  >
                    <Select
                      value={rule.field}
                      onValueChange={(field: ContactSegmentRule["field"]) =>
                        setRules((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, field } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lifecycle_stage">Lifecycle</SelectItem>
                        <SelectItem value="tag">Tag</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={rule.operator}
                      onValueChange={(
                        operator: ContactSegmentRule["operator"],
                      ) =>
                        setRules((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, operator } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">Equals</SelectItem>
                        <SelectItem value="contains">Contains</SelectItem>
                        <SelectItem value="not_equals">Does not equal</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={rule.value}
                      onChange={(event) =>
                        setRules((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Value"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setRules((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      disabled={rules.length === 1}
                      aria-label="Remove rule"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            onClick={() =>
              onSave({
                id: editing?.id,
                name,
                description,
                filterDefinition:
                  listType === "dynamic" ? rules : [],
              })
            }
            disabled={
              working ||
              !name.trim() ||
              (listType === "dynamic" &&
                rules.some((rule) => !rule.value.trim()))
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save" : "Create"}{" "}
            {listType === "dynamic" ? "segment" : "list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactImportDialog({
  lists,
  onCreateList,
  onImport,
  onOpenChange,
  open,
  working,
}: {
  lists: ContactListRecord[];
  onCreateList: (name: string) => Promise<ContactListRecord | null>;
  onImport: (
    fileName: string,
    rows: ContactImportRow[],
    listId: string,
  ) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  working: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedContactImport | null>(null);
  const [mapping, setMapping] = useState<ContactImportMapping>({});
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [destinationListId, setDestinationListId] = useState("");
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  useEffect(() => {
    if (open) return;
    setParsed(null);
    setMapping({});
    setReading(false);
    setDragging(false);
    setError("");
    setDestinationListId("");
    setNewListOpen(false);
    setNewListName("");
    setCreatingList(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [open]);

  const chooseFile = async (file: File) => {
    setReading(true);
    setError("");
    try {
      const next = await parseContactImportFile(file);
      const nextMapping = inferContactImportMapping(next.headers, next.rows);
      if (!Object.values(nextMapping).includes("email")) {
        throw new Error(
          "No email column could be detected. Check that the file contains valid email addresses.",
        );
      }
      setParsed(next);
      setMapping(nextMapping);
    } catch (caught) {
      setParsed(null);
      setMapping({});
      setError(
        caught instanceof Error
          ? caught.message
          : "This contact file could not be read.",
      );
    } finally {
      setReading(false);
    }
  };

  const mappableColumns = useMemo(
    () =>
      (parsed?.headers || [])
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => !isContactImportMetadataHeader(header)),
    [parsed],
  );

  const mappedRows = useMemo(() => {
    if (!parsed) return [];
    try {
      return mapContactImportRows(parsed, mapping);
    } catch {
      return [];
    }
  }, [mapping, parsed]);
  const validEmails = mappedRows.filter((row) =>
    isContactImportEmail(row.email),
  );
  const uniqueEmails = new Set(
    validEmails.map((row) => row.email.trim().toLowerCase()),
  );
  const invalidCount = mappedRows.length - validEmails.length;
  const duplicateCount = validEmails.length - uniqueEmails.size;
  const hasEmailMapping = Object.values(mapping).includes("email");
  const availableLists = lists.filter((list) => list.listType === "static");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[920px] overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Import contacts</DialogTitle>
              <DialogDescription className="mt-1">
                Upload CSV or Excel. Email, phone, first name, and last name
                are detected automatically, and existing email matches are
                updated instead of duplicated.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void chooseFile(file);
          }}
        />

        <div className="space-y-5 px-6 py-5">
          {!parsed ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node))
                  return;
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void chooseFile(file);
              }}
              className={cn(
                "flex min-h-[260px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/[0.06]"
                  : "border-border bg-muted/20 hover:border-primary/40 hover:bg-primary/[0.025]",
              )}
            >
              {reading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background shadow-sm">
                  <Upload className="h-6 w-6 text-primary" />
                </span>
              )}
              <span className="mt-5 text-[14px] font-semibold">
                {reading
                  ? "Reading your contacts…"
                  : "Drop a contact file here"}
              </span>
              <span className="mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">
                CSV or Excel (.xlsx), up to 10 MB and 5,000 contacts. Files
                with or without column headings are supported.
              </span>
              {!reading ? (
                <span className="mt-5 rounded-lg bg-foreground px-4 py-2 text-[11px] font-medium text-background">
                  Choose file
                </span>
              ) : null}
            </button>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">
                      {parsed.fileName}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {parsed.rows.length.toLocaleString()} row
                      {parsed.rows.length === 1 ? "" : "s"} ·{" "}
                      {parsed.headers.length} columns
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={working || reading}
                  loading={reading}
                  loadingLabel="Reading contact file"
                >
                  Change file
                </Button>
              </div>

              <section className="rounded-xl border border-border bg-muted/15 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="contact-import-list">
                      Destination list
                      <span className="ml-1 text-destructive">*</span>
                    </Label>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Required. Every created or updated contact is attached to
                      the selected static list.
                    </p>
                    <Select
                      value={destinationListId}
                      onValueChange={setDestinationListId}
                    >
                      <SelectTrigger
                        id="contact-import-list"
                        className="mt-3 max-w-md"
                        aria-label="Import destination list"
                      >
                        <SelectValue placeholder="Select a contact list" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name} ({list.memberCount.toLocaleString()})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {availableLists.length === 0 ? (
                      <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                        Create a static list before importing contacts.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setNewListOpen((current) => !current)}
                    disabled={working || creatingList}
                  >
                    <Plus className="h-4 w-4" />
                    Create list
                  </Button>
                </div>
                {newListOpen ? (
                  <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                    <Input
                      value={newListName}
                      onChange={(event) => setNewListName(event.target.value)}
                      placeholder="New contact list name"
                      aria-label="New contact list name"
                      className="sm:max-w-md"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.preventDefault();
                      }}
                    />
                    <Button
                      type="button"
                      disabled={
                        working || creatingList || !newListName.trim()
                      }
                      loading={creatingList}
                      loadingLabel="Creating contact list"
                      onClick={async () => {
                        setCreatingList(true);
                        let created: ContactListRecord | null = null;
                        try {
                          created = await onCreateList(newListName.trim());
                        } finally {
                          setCreatingList(false);
                        }
                        if (!created) return;
                        setDestinationListId(created.id);
                        setNewListName("");
                        setNewListOpen(false);
                      }}
                    >
                      <Check className="h-4 w-4" />
                      Create and select
                    </Button>
                  </div>
                ) : null}
              </section>

              <section>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[12px] font-medium">Column mapping</p>
                  <p className="text-[10px] text-muted-foreground">
                    Detected automatically. Change any column that was read
                    wrongly.
                  </p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {mappableColumns.map(({ header, index }) => (
                    <label
                      key={`${header}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {header || `Column ${index + 1}`}
                      </span>
                      <select
                        aria-label={`Map ${header || `Column ${index + 1}`}`}
                        value={mapping[index] || "skip"}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [index]: event.target
                              .value as ContactImportTarget,
                          }))
                        }
                        className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-[11px]"
                      >
                        {contactImportTargetOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {!hasEmailMapping ? (
                  <p className="mt-2 text-[10px] text-destructive">
                    Map one column to Email before importing.
                  </p>
                ) : null}
              </section>

              <section>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full">
                    {uniqueEmails.size.toLocaleString()} ready
                  </Badge>
                  {duplicateCount ? (
                    <Badge variant="outline" className="rounded-full">
                      {duplicateCount} duplicate{" "}
                      {duplicateCount === 1 ? "row" : "rows"} merged
                    </Badge>
                  ) : null}
                  {invalidCount ? (
                    <Badge
                      variant="outline"
                      className="rounded-full border-amber-500/30 text-amber-700 dark:text-amber-300"
                    >
                      {invalidCount} invalid{" "}
                      {invalidCount === 1 ? "email" : "emails"} skipped
                    </Badge>
                  ) : null}
                </div>
                <div className="dashboard-scroll mt-3 overflow-x-auto rounded-xl border border-border">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Full name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Tags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappedRows.slice(0, 5).map((row, index) => (
                        <TableRow key={`${row.email}-${index}`}>
                          <TableCell
                            className={cn(
                              "text-[10px]",
                              !isContactImportEmail(row.email) &&
                                "text-destructive",
                            )}
                          >
                            {row.email || "Missing email"}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {row.fullName || row.email || "Not provided"}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {row.phone || "Not provided"}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {row.company || "Not provided"}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {row.tags.join(", ") || "None"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {mappedRows.length > 5 ? (
                  <p className="mt-2 text-[9px] text-muted-foreground">
                    Showing the first 5 of {mappedRows.length.toLocaleString()}{" "}
                    rows.
                  </p>
                ) : null}
              </section>
            </>
          )}

          {error ? (
            <div
              className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[11px] text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              working ||
              !parsed ||
              !hasEmailMapping ||
              !destinationListId ||
              uniqueEmails.size === 0
            }
            loading={working}
            loadingLabel="Importing contacts"
            onClick={async () => {
              if (!parsed) return;
              const completed = await onImport(
                parsed.fileName,
                mappedRows,
                destinationListId,
              );
              if (completed) onOpenChange(false);
            }}
          >
            <Upload className="h-4 w-4" />
            Import {uniqueEmails.size.toLocaleString()} contact
            {uniqueEmails.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactExportDialog({
  contacts,
  lists,
  onOpenChange,
  open,
}: {
  contacts: ContactRecord[];
  lists: ContactListRecord[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [listId, setListId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const availableLists = lists.filter((list) => list.listType === "static");
  const selectedList = availableLists.find((list) => list.id === listId) || null;
  const exportContacts = selectedList
    ? contactsForList(contacts, selectedList)
    : [];

  useEffect(() => {
    if (!open) {
      setListId("");
      setExportError("");
    }
  }, [open]);

  const handleExport = async () => {
    if (!selectedList || exportContacts.length === 0) return;
    setExporting(true);
    setExportError("");
    try {
      // Keep the action state visible long enough to confirm the click and
      // give the browser time to paint it before starting the download.
      await new Promise((resolve) => setTimeout(resolve, 650));
      downloadContacts(
        exportContacts,
        timestampedCsvFilename(selectedList.name),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      onOpenChange(false);
    } catch {
      setExportError(
        "The contact list could not be exported. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!exporting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-[520px] p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Export contacts</DialogTitle>
              <DialogDescription className="mt-1">
                Choose the contact list you want to download as a CSV file.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <div>
            <Label htmlFor="contact-export-list">
              Contact list
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger
                id="contact-export-list"
                className="mt-2"
                aria-label="Export contact list"
              >
                <SelectValue placeholder="Select a contact list" />
              </SelectTrigger>
              <SelectContent>
                {availableLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name} ({list.memberCount.toLocaleString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableLists.length === 0 ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11px] text-amber-800 dark:text-amber-200">
              Create a static contact list before exporting contacts.
            </div>
          ) : selectedList ? (
            <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
              <p className="text-[11px] font-medium">{selectedList.name}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {exportContacts.length.toLocaleString()} contact
                {exportContacts.length === 1 ? "" : "s"} will be exported.
              </p>
            </div>
          ) : null}
          {exportError ? (
            <div
              className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[11px] text-destructive"
              role="alert"
            >
              {exportError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              exporting || !selectedList || exportContacts.length === 0
            }
            loading={exporting}
            loadingLabel="Exporting contacts"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export {exportContacts.length.toLocaleString()} contact
            {exportContacts.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsModule({
  userId,
  embedded = false,
  initialTab = "contacts",
  showNavigation = true,
}: ContactsModuleProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ContactsTab>(initialTab);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [lists, setLists] = useState<ContactListRecord[]>([]);
  const [fields, setFields] = useState<ContactCustomField[]>([]);
  const [crmSettings, setCrmSettings] = useState<ContactCrmSettings>(
    defaultContactCrmSettings,
  );
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const [listFilter, setListFilter] = useState("all");
  const [selectCreatedListOnSave, setSelectCreatedListOnSave] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] =
    useState<ContactRecord | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [listDialogType, setListDialogType] = useState<
    "static" | "dynamic"
  >("static");
  const [editingList, setEditingList] =
    useState<ContactListRecord | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [editingField, setEditingField] =
    useState<ContactCustomField | null>(null);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] =
    useState<ContactCustomField["fieldType"]>("text");
  const [fieldOptions, setFieldOptions] = useState("");
  const [fieldMappable, setFieldMappable] = useState(true);
  const [settingsStageDraft, setSettingsStageDraft] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeWinnerId, setMergeWinnerId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const contactsQuery = usePersistentQuery<ContactsWorkspaceData>({
    cacheKey: persistentCacheKey("contacts", "workspace", userId),
    cacheScope: "contacts",
    enabled: Boolean(userId),
    queryFn: async () => {
      const [nextContacts, nextLists, nextFields, nextSettings] =
        await Promise.all([
          listContacts(userId!),
          listContactLists(userId!),
          listContactCustomFields(userId!),
          getContactCrmSettings(userId!),
        ]);
      return {
        contacts: nextContacts,
        crmSettings: nextSettings,
        fields: nextFields,
        lists: nextLists,
      };
    },
    queryKey: queryKeys.contacts.workspace(userId),
    tags: ["contacts", userId || ""],
  });

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const applyWorkspaceData = useCallback((next: ContactsWorkspaceData) => {
    setContacts(next.contacts);
    setLists(next.lists);
    setFields(next.fields);
    setCrmSettings(next.crmSettings);
  }, []);

  const load = useCallback(async () => {
    if (!userId) {
      setContacts([]);
      setLists([]);
      setFields([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await contactsQuery.refetch();
    if (result.data) {
      applyWorkspaceData(result.data);
      setLoading(false);
      return;
    }
    if (result.error) {
      toast({
        title: "Contacts could not be loaded",
        description:
          result.error instanceof Error ? result.error.message : "Try again.",
        variant: "destructive",
      });
    }
    setLoading(false);
  }, [applyWorkspaceData, contactsQuery, toast, userId]);

  useEffect(() => {
    if (!userId) {
      setContacts([]);
      setLists([]);
      setFields([]);
      setLoading(false);
      return;
    }
    if (contactsQuery.data) {
      applyWorkspaceData(contactsQuery.data);
      setLoading(false);
      return;
    }
    if (contactsQuery.isError) {
      toast({
        title: "Contacts could not be loaded",
        description:
          contactsQuery.error instanceof Error
            ? contactsQuery.error.message
            : "Try again.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setLoading(contactsQuery.isInitialLoading);
  }, [
    applyWorkspaceData,
    contactsQuery.data,
    contactsQuery.error,
    contactsQuery.isError,
    contactsQuery.isInitialLoading,
    toast,
    userId,
  ]);

  useEffect(() => {
    if (!userId || loading || contactsQuery.isError) return;
    const workspaceData = {
      contacts,
      crmSettings,
      fields,
      lists,
    } satisfies ContactsWorkspaceData;
    queryClient.setQueryData(queryKeys.contacts.workspace(userId), workspaceData);
    void setCachedServerState(
      persistentCacheKey("contacts", "workspace", userId),
      workspaceData,
      "contacts",
      ["contacts", userId],
    );
  }, [
    contacts,
    crmSettings,
    fields,
    lists,
    loading,
    contactsQuery.isError,
    queryClient,
    userId,
  ]);

  const visibleContacts = useMemo(
    () =>
      contacts.filter((contact) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          [
            contact.fullName,
            contact.email,
            contact.phone,
            contact.company,
            contact.tags.join(" "),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);
        const matchesLifecycle =
          lifecycleFilter === "all" ||
          contact.lifecycleStage === lifecycleFilter;
        const selectedList =
          listFilter === "all"
            ? null
            : lists.find((list) => list.id === listFilter);
        const matchesList =
          !selectedList ||
          (selectedList.listType === "dynamic"
            ? contactMatchesSegment(contact, selectedList.filterDefinition)
            : contact.listIds.includes(selectedList.id));
        return matchesSearch && matchesLifecycle && matchesList;
      }),
    [contacts, lifecycleFilter, listFilter, lists, search],
  );

  const profileContact =
    contacts.find((contact) => contact.id === profileId) || null;
  const activeCount = contacts.filter(
    (contact) => !contact.unsubscribedAt,
  ).length;
  const customerCount = contacts.filter(
    (contact) => contact.lifecycleStage === "customer",
  ).length;
  const contactsPagination = useTablePagination(
    visibleContacts,
    10,
    `${search}:${lifecycleFilter}:${listFilter}`,
  );
  const contactsViewportRef = useRef<HTMLDivElement | null>(null);
  const contactVirtualizer = useVirtualizer({
    count: contactsPagination.pageItems.length,
    estimateSize: () => 64,
    getScrollElement: () => contactsViewportRef.current,
    overscan: 12,
  });
  const virtualContactRows = contactVirtualizer.getVirtualItems();

  const saveContact = async (draft: ContactDraft, listIds: string[]) => {
    if (!userId) return;
    setWorking(true);
    try {
      const input = {
        company: draft.company,
        email: draft.email,
        fullName: draft.fullName,
        lifecycleStage: draft.lifecycleStage,
        phone: draft.phone,
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const savedContact = editingContact
        ? await updateContact(userId, editingContact.id, input)
        : await createContact(userId, input);

      const staticListIds = new Set(
        lists
          .filter((list) => list.listType === "static")
          .map((list) => list.id),
      );
      const currentListIds = new Set(
        (editingContact?.listIds || []).filter((id) => staticListIds.has(id)),
      );
      const nextListIds = new Set(
        listIds.filter((id) => staticListIds.has(id)),
      );

      await Promise.all([
        ...Array.from(nextListIds)
          .filter((id) => !currentListIds.has(id))
          .map((id) =>
            addContactsToList(userId, id, [savedContact.id], "manual"),
          ),
        ...Array.from(currentListIds)
          .filter((id) => !nextListIds.has(id))
          .map((id) =>
            removeContactsFromList(userId, id, [savedContact.id]),
          ),
      ]);

      setContactOpen(false);
      toast({ title: editingContact ? "Contact updated" : "Contact created" });
      await load();
    } catch (error) {
      toast({
        title: "Contact was not saved",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const removeSelected = async () => {
    if (!userId || selected.length === 0) return;
    setWorking(true);
    try {
      const count = await deleteContacts(userId, selected);
      setSelected([]);
      toast({ title: `${count} contact${count === 1 ? "" : "s"} deleted` });
      await load();
    } catch (error) {
      toast({
        title: "Contacts were not deleted",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const assignSelected = async (list: ContactListRecord) => {
    if (!userId || selected.length === 0) return;
    try {
      const count = await addContactsToList(userId, list.id, selected);
      toast({ title: `${count} contact${count === 1 ? "" : "s"} added` });
      setSelected([]);
      await load();
    } catch (error) {
      toast({
        title: "Contacts were not added",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const createListFromContact = async (name: string) => {
    if (!userId) return null;
    try {
      const created = await saveContactList(userId, {
        name,
        description: "",
        listType: "static",
        filterDefinition: [],
      });
      setLists((current) => [
        created,
        ...current.filter((list) => list.id !== created.id),
      ]);
      toast({ title: "List created and selected" });
      return created;
    } catch (error) {
      toast({
        title: "List was not created",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  const saveList = async (input: {
    id?: string;
    name: string;
    description: string;
    filterDefinition: ContactSegmentRule[];
  }) => {
    if (!userId) return;
    setWorking(true);
    try {
      const savedList = await saveContactList(userId, {
        ...input,
        listType: listDialogType,
      });
      if (selectCreatedListOnSave && !input.id) {
        setListFilter(savedList.id);
        setActiveTab("contacts");
      }
      setSelectCreatedListOnSave(false);
      setListOpen(false);
      toast({
        title: input.id
          ? `${listDialogType === "dynamic" ? "Segment" : "List"} updated`
          : listDialogType === "dynamic"
            ? "Segment created"
            : "List created",
      });
      await load();
    } catch (error) {
      toast({
        title: "List was not saved",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  const importFile = async (
    fileName: string,
    rows: ContactImportRow[],
    listId: string,
  ) => {
    if (!userId) return false;
    const destinationList = lists.find(
      (list) => list.id === listId && list.listType === "static",
    );
    if (!destinationList) {
      toast({
        title: "Choose a destination list",
        description: "Imported contacts must be attached to a static list.",
        variant: "destructive",
      });
      return false;
    }
    setWorking(true);
    try {
      const result = await importContacts(userId, fileName, listId, rows);
      toast({
        title: "Import complete",
        description: `${result.importedCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped. ${result.contactIds.length} attached to ${destinationList.name}.`,
      });
      await load();
      return true;
    } catch (error) {
      toast({
        title: "Import failed",
        description:
          error instanceof Error
            ? error.message
            : "Check the spreadsheet and try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-[320px] max-w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", embedded ? "pb-2" : "pb-12")}>
      {!embedded && (
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium text-primary">Contacts</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight sm:text-[34px]">
            People and audiences
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {contacts.length} total · {activeCount} subscribed · {customerCount} customers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void load()}
            aria-label="Refresh contacts"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setExportOpen(true)}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            type="button"
            onClick={() => {
              setEditingContact(null);
              setContactOpen(true);
            }}
          >
            <UserPlus className="h-4 w-4" />
            New contact
          </Button>
        </div>
      </header>
      )}

      {embedded && showNavigation && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[18px] font-semibold">Contact directory</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {contacts.length} shared contact
              {contacts.length === 1 ? "" : "s"} from forms, events, email,
              payments, documents, and CRM work.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void load()}
              aria-label="Refresh contacts"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button
              type="button"
              onClick={() => {
                setEditingContact(null);
                setContactOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" />
              New contact
            </Button>
          </div>
        </div>
      )}

      {showNavigation && (
      <nav
        className={cn(
          "dashboard-scroll flex gap-6 overflow-x-auto border-b border-border",
          embedded ? "mt-0" : "mt-7",
        )}
        aria-label="Contacts views"
      >
        {(embedded
          ? tabs.filter(
              (tab) => tab.key !== "import" && tab.key !== "settings",
            )
          : tabs
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 pb-3 text-[12px] font-medium text-muted-foreground",
                activeTab === tab.key && "text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </nav>
      )}

      {activeTab === "contacts" && (
        <section className="mt-6">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <TableFilterBar className="min-w-0 flex-1">
              <TableSearchField
                value={search}
                onValueChange={setSearch}
                placeholder="Search contacts"
                aria-label="Search contacts"
              />
              <TableFilterSelect
                value={lifecycleFilter}
                onValueChange={setLifecycleFilter}
                label="Filter contacts by lifecycle stage"
                className="sm:w-[190px]"
                options={[
                  { value: "all", label: "All lifecycle stages" },
                  ...crmSettings.lifecycleStages.map((stage) => ({
                    value: stage,
                    label: titleCase(stage),
                  })),
                ]}
              />
              <TableFilterSelect
                value={listFilter}
                onValueChange={(value) => {
                  if (value === "__create-list") {
                    setListDialogType("static");
                    setEditingList(null);
                    setSelectCreatedListOnSave(true);
                    setListOpen(true);
                    return;
                  }
                  setListFilter(value);
                }}
                label="Filter contacts by list"
                options={[
                  { value: "all", label: "All lists" },
                  ...lists.map((list) => ({
                    value: list.id,
                    label: list.name,
                  })),
                  {
                    value: "__create-list",
                    label: (
                      <span className="flex items-center gap-2 text-primary">
                        <Plus className="h-3.5 w-3.5" />
                        Create new list
                      </span>
                    ),
                  },
                ]}
              />
            </TableFilterBar>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {visibleContacts.length} shown
              </span>
            </div>
          </div>
          <TableSelectionBar
            className="mt-3"
            totalCount={visibleContacts.length}
            selectedCount={
              visibleContacts.filter((contact) =>
                selected.includes(contact.id),
              ).length
            }
            allSelected={
              visibleContacts.length > 0 &&
              visibleContacts.every((contact) =>
                selected.includes(contact.id),
              )
            }
            partiallySelected={
              visibleContacts.some((contact) =>
                selected.includes(contact.id),
              ) &&
              !visibleContacts.every((contact) =>
                selected.includes(contact.id),
              )
            }
            onToggleAll={(checked) =>
              setSelected(
                checked
                  ? Array.from(
                      new Set([
                        ...selected,
                        ...visibleContacts.map((contact) => contact.id),
                      ]),
                    )
                  : selected.filter(
                      (id) =>
                        !visibleContacts.some(
                          (contact) => contact.id === id,
                        ),
                    ),
              )
            }
            onClear={() => setSelected([])}
            itemLabel="contacts"
          >
            {selected.length === 2 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMergeWinnerId(selected[0]);
                  setMergeOpen(true);
                }}
              >
                <Users className="h-4 w-4" />
                Merge
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <ListFilter className="h-4 w-4" />
                  Add to list
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {lists.filter((list) => list.listType === "static").length ===
                0 ? (
                  <DropdownMenuItem disabled>No static lists</DropdownMenuItem>
                ) : (
                  lists
                    .filter((list) => list.listType === "static")
                    .map((list) => (
                      <DropdownMenuItem
                        key={list.id}
                        onClick={() => void assignSelected(list)}
                      >
                        {list.name}
                      </DropdownMenuItem>
                    ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void removeSelected()}
              disabled={working}
              className="text-destructive"
              aria-label="Delete selected contacts"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </TableSelectionBar>

          {visibleContacts.length === 0 ? (
            <EmptyState
              icon={ContactRound}
              title={contacts.length === 0 ? "No contacts yet" : "No contacts match"}
              description={
                contacts.length === 0
                  ? "Contacts created manually, from forms, imports, and automations will appear here."
                  : "Change the search or filters to see more contacts."
              }
              action={
                contacts.length === 0 ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingContact(null);
                      setContactOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add contact
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div
              ref={contactsViewportRef}
              className="dashboard-scroll mt-3 max-h-[680px] overflow-auto border-b border-border"
            >
            <Table className="grid min-w-[1140px]">
              <TableHeader className="sticky top-0 z-10 grid bg-background">
                <TableRow className={cn("grid", contactGridColumns)}>
                  <TableHead className="w-12 px-3">
                    <Checkbox
                      checked={
                        visibleContacts.length > 0 &&
                        visibleContacts.every((contact) =>
                          selected.includes(contact.id),
                        )
                      }
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? Array.from(
                                new Set([
                                  ...selected,
                                  ...visibleContacts.map((contact) => contact.id),
                                ]),
                              )
                            : selected.filter(
                                (id) =>
                                  !visibleContacts.some(
                                    (contact) => contact.id === id,
                                  ),
                              ),
                        )
                      }
                      aria-label="Select all contacts"
                    />
                  </TableHead>
                  <TableHead className="min-w-[240px] px-3">Contact</TableHead>
                  <TableHead className="min-w-[150px] px-3">Phone</TableHead>
                  <TableHead className="min-w-[140px] px-3">Lifecycle</TableHead>
                  <TableHead className="min-w-[150px] px-3">Company</TableHead>
                  <TableHead className="min-w-[170px] px-3">Lists</TableHead>
                  <TableHead className="min-w-[120px] px-3">Activity</TableHead>
                  <TableHead className="w-12 px-3" />
                </TableRow>
              </TableHeader>
              <TableBody
                className="relative grid"
                style={{
                  height: `${contactVirtualizer.getTotalSize()}px`,
                }}
              >
                {virtualContactRows.map((virtualRow) => {
                  const contact = contactsPagination.pageItems[virtualRow.index];
                  if (!contact) return null;
                  return (
                  <TableRow
                    key={contact.id}
                    ref={contactVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className={cn(
                      "absolute left-0 top-0 grid w-full cursor-pointer",
                      contactGridColumns,
                    )}
                    onClick={() => {
                      setProfileId(contact.id);
                      setProfileOpen(true);
                    }}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <TableCell
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.includes(contact.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, contact.id]
                              : current.filter((id) => id !== contact.id),
                          )
                        }
                        aria-label={`Select ${contact.fullName || contact.email}`}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                            {initials(contact.fullName, contact.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium">
                            {contact.fullName || contact.email}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {contact.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      className="truncate px-3 py-3 text-[11px] text-muted-foreground"
                      title={contact.phone || undefined}
                    >
                      {contact.phone || "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded px-2 py-0.5 text-[9px] font-medium",
                          lifecycleClasses(contact.lifecycleStage),
                        )}
                      >
                        {titleCase(contact.lifecycleStage)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-[11px] text-muted-foreground">
                      {contact.company || "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex max-w-[180px] flex-wrap gap-1">
                        {contact.listNames.slice(0, 2).map((name) => (
                          <span
                            key={name}
                            className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                          >
                            {name}
                          </span>
                        ))}
                        {contact.listNames.length > 2 && (
                          <span className="text-[9px] text-muted-foreground">
                            +{contact.listNames.length - 2}
                          </span>
                        )}
                        {contact.listNames.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-[10px] text-muted-foreground">
                      {formatDate(contact.lastActivityAt)}
                    </TableCell>
                    <TableCell
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${contact.fullName || contact.email}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingContact(contact);
                              setContactOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={async () => {
                              if (!userId) return;
                              await deleteContacts(userId, [contact.id]);
                              toast({ title: "Contact deleted" });
                              await load();
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
          <TablePagination
            className="mt-3"
            page={contactsPagination.page}
            pageCount={contactsPagination.pageCount}
            pageSize={contactsPagination.pageSize}
            totalCount={contactsPagination.totalCount}
            onPageChange={(page) => {
              contactsPagination.setPage(page);
              contactsViewportRef.current?.scrollTo({ top: 0 });
            }}
            itemLabel="contacts"
          />
        </section>
      )}

      {(activeTab === "lists" || activeTab === "segments") && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-4 border-y border-border py-4">
            <div>
              <h2 className="text-[16px] font-semibold">
                {activeTab === "segments" ? "Dynamic segments" : "Contact lists"}
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {activeTab === "segments"
                  ? "Rule-based audiences that stay current."
                  : "Static audiences for forms, workflows, and campaigns."}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                setListDialogType(
                  activeTab === "segments" ? "dynamic" : "static",
                );
                setEditingList(null);
                setSelectCreatedListOnSave(false);
                setListOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New {activeTab === "segments" ? "segment" : "list"}
            </Button>
          </div>
          {lists.filter(
            (list) =>
              list.listType ===
              (activeTab === "segments" ? "dynamic" : "static"),
          ).length === 0 ? (
            <EmptyState
              icon={activeTab === "segments" ? Filter : ListFilter}
              title={`No ${activeTab === "segments" ? "segments" : "lists"}`}
              description={
                activeTab === "segments"
                  ? "Build a segment from lifecycle, tags, company, or email rules."
                  : "Create a list and connect it to forms or campaigns."
              }
            />
          ) : (
            <div>
              {lists
                .filter(
                  (list) =>
                    list.listType ===
                    (activeTab === "segments" ? "dynamic" : "static"),
                )
                .map((list) => {
                  const count =
                    list.listType === "dynamic"
                      ? contacts.filter((contact) =>
                          contactMatchesSegment(
                            contact,
                            list.filterDefinition,
                          ),
                        ).length
                      : list.memberCount;
                  return (
                    <div
                      key={list.id}
                      className="grid items-center gap-4 border-b border-border py-5 sm:grid-cols-[minmax(0,1fr)_120px_150px_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">
                          {list.name}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          {list.description || "No description"}
                        </p>
                        {list.listType === "dynamic" && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {list.filterDefinition.map((rule, index) => (
                              <span
                                key={`${rule.field}-${index}`}
                                className="rounded bg-muted px-2 py-1 text-[9px] text-muted-foreground"
                              >
                                {titleCase(rule.field)} {rule.operator.replace(/_/g, " ")} {rule.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold">{count}</p>
                        <p className="mt-1 text-[9px] uppercase text-muted-foreground">
                          Contacts
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px]">{formatDate(list.updatedAt)}</p>
                        <p className="mt-1 text-[9px] uppercase text-muted-foreground">
                          Updated
                        </p>
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveTab("contacts");
                            setListFilter(list.id);
                          }}
                        >
                          View
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setListDialogType(list.listType);
                            setEditingList(list);
                            setSelectCreatedListOnSave(false);
                            setListOpen(true);
                          }}
                          aria-label={`Edit ${list.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            if (!userId) return;
                            await deleteContactList(userId, list.id);
                            toast({ title: `${titleCase(list.listType)} deleted` });
                            await load();
                          }}
                          aria-label={`Delete ${list.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {activeTab === "fields" && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-4 border-y border-border py-4">
            <div>
              <h2 className="text-[16px] font-semibold">Custom fields</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Extend every contact profile with workspace-specific data.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                setEditingField(null);
                setFieldLabel("");
                setFieldType("text");
                setFieldOptions("");
                setFieldMappable(true);
                setFieldOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New field
            </Button>
          </div>
          {fields.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="No custom fields"
              description="Create fields for the contact data your workspace needs."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Form mapping</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={field.id}>
                    <TableCell className="text-[12px] font-medium">
                      {field.label}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <code className="text-[10px] text-muted-foreground">
                        {field.fieldKey}
                      </code>
                    </TableCell>
                    <TableCell className="text-[11px] capitalize">
                      {field.fieldType}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {field.formMappable ? "Available" : "Hidden"}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingField(field);
                          setFieldLabel(field.label);
                          setFieldType(field.fieldType);
                          setFieldOptions(field.options.join(", "));
                          setFieldMappable(field.formMappable);
                          setFieldOpen(true);
                        }}
                        aria-label={`Edit ${field.label}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (!userId) return;
                          await deleteContactCustomField(userId, field.id);
                          toast({ title: "Custom field deleted" });
                          await load();
                        }}
                        aria-label={`Delete ${field.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {activeTab === "import" && (
        <section className="mt-6">
          <div className="grid border-y border-border md:grid-cols-2">
            <div className="border-b border-border p-6 md:border-b-0 md:border-r">
              <Upload className="h-5 w-5 text-primary" />
              <h2 className="mt-4 text-[16px] font-semibold">
                Import contacts
              </h2>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                Upload CSV or Excel, review every mapped column, and update
                matching emails without creating duplicates.
              </p>
              <Button
                type="button"
                className="mt-5"
                onClick={() => setImportOpen(true)}
                disabled={working}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import CSV or Excel
              </Button>
            </div>
            <div className="p-6">
              <Download className="h-5 w-5 text-primary" />
              <h2 className="mt-4 text-[16px] font-semibold">Export contacts</h2>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                Choose a contact list and download only that audience as CSV.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => setExportOpen(true)}
                disabled={lists.every((list) => list.listType !== "static")}
              >
                <Download className="h-4 w-4" />
                Choose list to export
              </Button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "settings" && (
        <section className="mt-6 max-w-[780px]">
          <div className="border-y border-border py-6">
            <h2 className="text-[16px] font-semibold">Deduplication</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Choose how form and import records match existing contacts.
            </p>
            <div className="mt-5 max-w-[360px] space-y-2">
              <Label>Match contacts by</Label>
              <Select
                value={crmSettings.deduplicationMode}
                onValueChange={(
                  deduplicationMode: ContactCrmSettings["deduplicationMode"],
                ) =>
                  setCrmSettings({ ...crmSettings, deduplicationMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email address</SelectItem>
                  <SelectItem value="email_phone">Email and phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-b border-border py-6">
            <h2 className="text-[16px] font-semibold">Lifecycle stages</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Customize the stages used across contact profiles and filters.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {crmSettings.lifecycleStages.map((stage) => (
                <span
                  key={stage}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px]"
                >
                  {titleCase(stage)}
                  <button
                    type="button"
                    onClick={() =>
                      setCrmSettings({
                        ...crmSettings,
                        lifecycleStages: crmSettings.lifecycleStages.filter(
                          (item) => item !== stage,
                        ),
                      })
                    }
                    disabled={crmSettings.lifecycleStages.length <= 1}
                    aria-label={`Remove ${titleCase(stage)}`}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex max-w-[420px] gap-2">
              <Input
                value={settingsStageDraft}
                onChange={(event) =>
                  setSettingsStageDraft(event.target.value)
                }
                placeholder="New lifecycle stage"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const stage = settingsStageDraft
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "");
                  if (
                    stage &&
                    !crmSettings.lifecycleStages.includes(stage)
                  ) {
                    setCrmSettings({
                      ...crmSettings,
                      lifecycleStages: [
                        ...crmSettings.lifecycleStages,
                        stage,
                      ],
                    });
                  }
                  setSettingsStageDraft("");
                }}
                disabled={!settingsStageDraft.trim()}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          <div className="border-b border-border py-6">
            <Label htmlFor="crm-unsubscribe-footer">
              Campaign unsubscribe footer
            </Label>
            <Textarea
              id="crm-unsubscribe-footer"
              value={crmSettings.unsubscribeFooter}
              onChange={(event) =>
                setCrmSettings({
                  ...crmSettings,
                  unsubscribeFooter: event.target.value,
                })
              }
              className="mt-3 min-h-[90px]"
            />
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              type="button"
              onClick={async () => {
                if (!userId) return;
                setWorking(true);
                try {
                  const saved = await saveContactCrmSettings(
                    userId,
                    crmSettings,
                  );
                  setCrmSettings(saved);
                  toast({ title: "CRM settings saved" });
                } catch (error) {
                  toast({
                    title: "CRM settings were not saved",
                    description:
                      error instanceof Error ? error.message : "Try again.",
                    variant: "destructive",
                  });
                } finally {
                  setWorking(false);
                }
              }}
              disabled={
                working ||
                crmSettings.lifecycleStages.length === 0 ||
                !crmSettings.unsubscribeFooter.trim()
              }
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Settings className="h-4 w-4" />
              )}
              Save CRM settings
            </Button>
          </div>
        </section>
      )}

      <ContactImportDialog
        lists={lists}
        onCreateList={createListFromContact}
        open={importOpen}
        working={working}
        onImport={importFile}
        onOpenChange={(open) => {
          if (!working) setImportOpen(open);
        }}
      />
      <ContactExportDialog
        contacts={contacts}
        lists={lists}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
      <ContactDialog
        contact={editingContact}
        lifecycleStages={crmSettings.lifecycleStages}
        lists={lists}
        onCreateList={createListFromContact}
        onOpenChange={(open) => {
          if (!working) setContactOpen(open);
        }}
        onSave={(draft, listIds) => void saveContact(draft, listIds)}
        open={contactOpen}
        working={working}
      />
      <ContactProfile
        contact={profileContact}
        lists={lists}
        onChange={() => void load()}
        onEdit={() => {
          if (!profileContact) return;
          setEditingContact(profileContact);
          setContactOpen(true);
        }}
        onOpenChange={setProfileOpen}
        open={profileOpen}
        userId={userId || ""}
      />
      <ListDialog
        editing={editingList}
        listType={listDialogType}
        onOpenChange={(open) => {
          if (!working) setListOpen(open);
        }}
        onSave={(input) => void saveList(input)}
        open={listOpen}
        working={working}
      />
      <Dialog open={fieldOpen} onOpenChange={setFieldOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editingField ? "Edit custom field" : "New custom field"}
            </DialogTitle>
            <DialogDescription>
              Add a reusable field to contact profiles.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custom-field-label">Label</Label>
              <Input
                id="custom-field-label"
                value={fieldLabel}
                onChange={(event) => setFieldLabel(event.target.value)}
                placeholder="Customer tier"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={fieldType}
                onValueChange={(value: ContactCustomField["fieldType"]) =>
                  setFieldType(value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fieldTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {titleCase(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fieldType === "select" && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="custom-field-options">Options</Label>
                <Input
                  id="custom-field-options"
                  value={fieldOptions}
                  onChange={(event) => setFieldOptions(event.target.value)}
                  placeholder="Free, Pro, Enterprise"
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-4 border-y border-border py-3 sm:col-span-2">
              <div>
                <p className="text-[11px] font-medium">Available to forms</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Allow this field in form-to-contact mapping.
                </p>
              </div>
              <Switch
                checked={fieldMappable}
                onCheckedChange={setFieldMappable}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFieldOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!userId) return;
                setWorking(true);
                try {
                  const input = {
                    label: fieldLabel,
                    fieldType,
                    options: fieldOptions
                      .split(",")
                      .map((option) => option.trim())
                      .filter(Boolean),
                    formMappable: fieldMappable,
                  };
                  if (editingField) {
                    await updateContactCustomField(
                      userId,
                      editingField.id,
                      input,
                    );
                  } else {
                    await createContactCustomField(userId, input);
                  }
                  setFieldOpen(false);
                  setFieldLabel("");
                  setFieldOptions("");
                  toast({
                    title: editingField
                      ? "Custom field updated"
                      : "Custom field created",
                  });
                  await load();
                } catch (error) {
                  toast({
                    title: "Custom field was not created",
                    description:
                      error instanceof Error ? error.message : "Try again.",
                    variant: "destructive",
                  });
                } finally {
                  setWorking(false);
                }
              }}
              disabled={
                working ||
                !fieldLabel.trim() ||
                (fieldType === "select" && !fieldOptions.trim())
              }
            >
              {working && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingField ? "Save field" : "Create field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeOpen}
        onOpenChange={(open) => {
          if (!working) setMergeOpen(open);
        }}
      >
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Merge duplicate contacts</DialogTitle>
            <DialogDescription>
              Choose the profile to keep. Lists, notes, tags, and timeline
              activity from the other profile will be combined into it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {selected
              .map((id) => contacts.find((contact) => contact.id === id))
              .filter((contact): contact is ContactRecord => Boolean(contact))
              .map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => setMergeWinnerId(contact.id)}
                  className={cn(
                    "border p-4 text-left transition-colors",
                    mergeWinnerId === contact.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                        {initials(contact.fullName, contact.email)}
                      </AvatarFallback>
                    </Avatar>
                    {mergeWinnerId === contact.id && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-4 truncate text-[12px] font-medium">
                    {contact.fullName || contact.email}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {contact.email}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {contact.phone || "No phone"}
                  </p>
                </button>
              ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMergeOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!userId || selected.length !== 2 || !mergeWinnerId) return;
                const mergedId = selected.find(
                  (id) => id !== mergeWinnerId,
                );
                if (!mergedId) return;
                setWorking(true);
                try {
                  await mergeContacts(userId, mergeWinnerId, mergedId);
                  setMergeOpen(false);
                  setSelected([]);
                  toast({ title: "Contacts merged" });
                  await load();
                } catch (error) {
                  toast({
                    title: "Contacts were not merged",
                    description:
                      error instanceof Error ? error.message : "Try again.",
                    variant: "destructive",
                  });
                } finally {
                  setWorking(false);
                }
              }}
              disabled={working || !mergeWinnerId}
            >
              {working && <Loader2 className="h-4 w-4 animate-spin" />}
              Merge contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
