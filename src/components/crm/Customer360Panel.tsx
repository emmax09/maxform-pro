import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  FileText,
  HeartPulse,
  Loader2,
  Mail,
  MessageSquarePlus,
  Network,
  Paperclip,
  Search,
  Ticket,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addContactActivity, createContactNote } from "@/lib/contacts";
import {
  getCrmContact360,
  type CrmContact360,
  type CrmContactSummary,
  type CrmTimelineEvent,
} from "@/lib/crm";
import { formatCurrency } from "@/lib/regional-options";
import { cn } from "@/lib/utils";

type Customer360PanelProps = {
  userId: string;
  contacts: CrmContactSummary[];
  currency: string;
};

const formatDate = (value: string | null, includeTime = false) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
};

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const sourceIcon = (source: string) => {
  if (source === "payments") return CircleDollarSign;
  if (source === "events") return Ticket;
  if (source === "appointments") return CalendarClock;
  if (source === "documents") return FileText;
  if (source === "files") return Paperclip;
  if (source === "campaigns") return Mail;
  return Activity;
};

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 truncate text-[17px] font-semibold">{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function TimelineRow({ event }: { event: CrmTimelineEvent }) {
  const Icon = sourceIcon(event.sourceModule);
  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium">{event.title}</p>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {formatDate(event.occurredAt, true)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
          {event.detail || titleCase(event.eventType)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
          <Badge variant="outline" className="h-5 px-1.5 text-[9px]">
            {titleCase(event.sourceModule)}
          </Badge>
          {event.actorName ? <span>by {event.actorName}</span> : null}
        </div>
      </div>
    </div>
  );
}

function RecordCount({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </span>
      <span className="text-[12px] font-semibold">{value}</span>
    </div>
  );
}

export function Customer360Panel({ userId, contacts, currency }: Customer360PanelProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(contacts[0]?.id || "");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [note, setNote] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [saving, setSaving] = useState<"note" | "activity" | null>(null);

  useEffect(() => {
    if (!contacts.some((contact) => contact.id === selectedId)) {
      setSelectedId(contacts[0]?.id || "");
    }
  }, [contacts, selectedId]);

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((contact) =>
      [contact.fullName, contact.email, contact.company]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [contacts, search]);

  const detailQuery = useQuery({
    enabled: Boolean(userId && selectedId),
    queryKey: ["crm-customer-360", userId, selectedId],
    queryFn: () => getCrmContact360(userId, selectedId),
    staleTime: 15_000,
  });
  const detail = detailQuery.data;
  const timeline = useMemo(
    () =>
      (detail?.timeline || []).filter(
        (event) => sourceFilter === "all" || event.sourceModule === sourceFilter,
      ),
    [detail?.timeline, sourceFilter],
  );

  const refreshDetail = () =>
    queryClient.invalidateQueries({
      queryKey: ["crm-customer-360", userId, selectedId],
    });

  const saveNote = async () => {
    if (!note.trim() || !selectedId) return;
    setSaving("note");
    try {
      await createContactNote(userId, selectedId, note.trim());
      setNote("");
      toast.success("Note added to the customer timeline.");
      refreshDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The note could not be saved.");
    } finally {
      setSaving(null);
    }
  };

  const saveActivity = async () => {
    if (!activityTitle.trim() || !selectedId) return;
    setSaving("activity");
    try {
      await addContactActivity(userId, selectedId, {
        activityType: "crm_manual_activity",
        title: activityTitle.trim(),
        detail: "Logged from Customer 360",
        entityType: "contact",
        entityId: selectedId,
      });
      setActivityTitle("");
      toast.success("Activity logged.");
      refreshDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The activity could not be logged.");
    } finally {
      setSaving(null);
    }
  };

  if (!contacts.length) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-6 py-14 text-center">
        <ContactRound className="h-5 w-5 text-primary" />
        <h3 className="mt-4 text-[15px] font-semibold">Customer 360 is ready</h3>
        <p className="mt-2 max-w-md text-[12px] leading-5 text-muted-foreground">
          Create or import a contact to see its complete relationship history here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ContactRound className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-[14px] font-semibold">Customers</h2>
            <p className="text-[10px] text-muted-foreground">Select a relationship to inspect</p>
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
            className="h-9 pl-9 text-[11px]"
          />
        </div>
        <div className="dashboard-scroll mt-3 max-h-[620px] space-y-1 overflow-y-auto pr-1">
          {filteredContacts.map((contact) => (
            <button
              type="button"
              key={contact.id}
              onClick={() => setSelectedId(contact.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                selectedId === contact.id && "bg-primary/8 text-primary",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                {(contact.fullName || contact.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">
                  {contact.fullName || contact.email}
                </span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                  {contact.company || contact.email}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {!filteredContacts.length ? (
            <p className="px-3 py-8 text-center text-[10px] text-muted-foreground">
              No customers match that search.
            </p>
          ) : null}
        </div>
      </section>

      <section className="min-w-0 space-y-5">
        {detailQuery.isLoading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : detailQuery.isError ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[12px] text-destructive">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Customer 360 could not be loaded."}
          </div>
        ) : detail ? (
            <CustomerProfile
              detail={detail}
              currency={currency}
              sourceFilter={sourceFilter}
            setSourceFilter={setSourceFilter}
            timeline={timeline}
            note={note}
            setNote={setNote}
            activityTitle={activityTitle}
            setActivityTitle={setActivityTitle}
            saving={saving}
            onSaveNote={() => void saveNote()}
            onSaveActivity={() => void saveActivity()}
          />
        ) : null}
      </section>
    </div>
  );
}

function CustomerProfile({
  detail,
  currency,
  sourceFilter,
  setSourceFilter,
  timeline,
  note,
  setNote,
  activityTitle,
  setActivityTitle,
  saving,
  onSaveNote,
  onSaveActivity,
}: {
  detail: CrmContact360;
  currency: string;
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  timeline: CrmTimelineEvent[];
  note: string;
  setNote: (value: string) => void;
  activityTitle: string;
  setActivityTitle: (value: string) => void;
  saving: "note" | "activity" | null;
  onSaveNote: () => void;
  onSaveActivity: () => void;
}) {
  const { contact, metrics, health } = detail;
  const healthTone =
    health.status === "healthy"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : health.status === "watch"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return (
    <>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[18px] font-semibold">
                  {contact.fullName || contact.email}
                </h2>
                <Badge variant="outline" className="text-[9px]">
                  {titleCase(contact.lifecycleStage)}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{contact.email}</span>
                {contact.phone ? <span>{contact.phone}</span> : null}
                {contact.company ? <span>{contact.company}</span> : null}
              </div>
            </div>
          </div>
          <Badge variant="outline" className={cn("gap-1.5 text-[9px]", healthTone)}>
            <HeartPulse className="h-3 w-3" />
            {titleCase(health.status)} · {health.score}/100
          </Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Revenue" value={formatCurrency(metrics.totalRevenue, currency)} detail={`${metrics.paymentCount} payment records`} />
          <Metric label="Active pipeline" value={formatCurrency(metrics.activeDealValueCents / 100, currency)} detail="Open linked deals" />
          <Metric label="Open work" value={String(metrics.openTaskCount)} detail={formatDate(metrics.nextActivityAt)} />
          <Metric label="Last activity" value={formatDate(metrics.lastActivityAt)} detail={`${detail.timeline.length} timeline events`} />
        </div>
        <div className="mt-4 rounded-lg border border-primary/15 bg-primary/[0.035] p-3">
          <p className="text-[10px] font-semibold">Relationship health</p>
          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
            {health.reasons.join(" · ")}
          </p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[13px] font-semibold">Universal timeline</h3>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Forms, events, appointments, payments, documents, campaigns, and CRM actions.
              </p>
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-[150px] text-[10px]" aria-label="Timeline source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {['forms', 'events', 'appointments', 'payments', 'documents', 'files', 'campaigns', 'crm'].map((source) => (
                  <SelectItem key={source} value={source}>{titleCase(source)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {timeline.length ? timeline.map((event) => <TimelineRow key={event.id} event={event} />) : (
              <p className="py-10 text-center text-[10px] text-muted-foreground">
                No events match this filter yet.
              </p>
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold">Connected records</h3>
            <div className="mt-3 space-y-2">
              <RecordCount icon={Activity} label="Timeline events" value={detail.timeline.length} />
              <RecordCount icon={CircleDollarSign} label="Payments" value={detail.payments.length} />
              <RecordCount icon={Ticket} label="Event tickets" value={detail.events.length} />
              <RecordCount icon={CalendarClock} label="Appointments" value={detail.appointments.length} />
              <RecordCount icon={FileText} label="Documents" value={detail.documents.length} />
              <RecordCount icon={Paperclip} label="Files" value={detail.files.length} />
              <RecordCount icon={Mail} label="Campaign touches" value={detail.campaigns.length} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              <div>
                <h3 className="text-[13px] font-semibold">Relationship graph</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  People explicitly connected to this relationship.
                </p>
              </div>
            </div>
            {detail.relationships.length ? (
              <div className="mt-3 space-y-2">
                {detail.relationships.map((relationship) => (
                  <div key={relationship.id} className="rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[10px] font-medium">{relationship.contactName}</p>
                      <Badge variant="outline" className="shrink-0 text-[8px]">
                        {titleCase(relationship.relationshipType)}
                      </Badge>
                    </div>
                    {relationship.notes ? (
                      <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{relationship.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : detail.relatedContacts.length ? (
              <div className="mt-3 rounded-lg border border-dashed border-border p-3">
                <p className="text-[10px] font-medium">{detail.relatedContacts.length} account peer{detail.relatedContacts.length === 1 ? "" : "s"}</p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  These contacts share a company. Add explicit relationship links when roles or influence matter.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                No explicit relationship links yet. The shared company and connected records still provide context.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="h-4 w-4 text-primary" />
              <h3 className="text-[13px] font-semibold">Add context</h3>
            </div>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a durable note about this relationship"
              className="mt-3 min-h-20 text-[10px]"
            />
            <Button type="button" size="sm" className="mt-2 w-full" disabled={!note.trim() || saving !== null} onClick={onSaveNote}>
              {saving === "note" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
              Add note
            </Button>
            <Input
              value={activityTitle}
              onChange={(event) => setActivityTitle(event.target.value)}
              placeholder="Log a call, meeting, or follow-up"
              className="mt-4 h-9 text-[10px]"
            />
            <Button type="button" size="sm" variant="outline" className="mt-2 w-full" disabled={!activityTitle.trim() || saving !== null} onClick={onSaveActivity}>
              {saving === "activity" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Log activity
            </Button>
          </section>

          {detail.duplicateCandidates.length ? (
            <section className="rounded-xl border border-amber-500/20 bg-amber-500/4 p-5">
              <h3 className="text-[13px] font-semibold">Possible duplicates</h3>
              <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                Review these matches before creating a new relationship record.
              </p>
              <div className="mt-3 space-y-2">
                {detail.duplicateCandidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <p className="text-[10px] font-medium">{candidate.fullName || candidate.email}</p>
                    <p className="mt-1 text-[9px] text-muted-foreground">{candidate.email}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
