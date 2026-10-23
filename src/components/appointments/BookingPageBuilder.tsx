import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  GripVertical,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  Users,
  Video,
} from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { cn } from "@/lib/utils";
import type {
  BookingPage,
  BookingPageQuestion,
  SchedulingConnection,
} from "@/lib/appointments";
import {
  emptyBookingPage,
  locationLabels,
  money,
  schedulingLabels,
} from "./appointment-format";
import { ProviderLogo } from "./provider-logos";

/**
 * Booking page builder.
 *
 * Full-screen, in the same shell as the campaign and email template builders:
 * a dimmed surround, a focused card, a setup rail on the left and a live
 * preview on the right that renders the page a visitor will actually see — the
 * "builder must equal production" rule the rest of the product follows.
 */
const FIELD_TYPES = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "file", label: "File upload" },
];

type PanelKey = "details" | "hosts" | "questions" | "branding" | "payment";

const panels: Array<{ key: PanelKey; label: string }> = [
  { key: "details", label: "Details" },
  { key: "hosts", label: "Hosts & scheduling" },
  { key: "questions", label: "Booking form" },
  { key: "branding", label: "Branding" },
  { key: "payment", label: "Payment" },
];

const fieldId = () => `f${Math.random().toString(36).slice(2, 9)}`;

export function BookingPageBuilder({
  connections,
  onClose,
  onSave,
  page,
  saving,
}: {
  connections: SchedulingConnection[];
  onClose: () => void;
  onSave: (input: Partial<BookingPage>) => void;
  /** null opens the builder on a new page. */
  page: BookingPage | null;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Partial<BookingPage>>(emptyBookingPage);
  const [panel, setPanel] = useState<PanelKey>("details");
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);

  useScrollLock(true);

  useEffect(() => {
    setDraft(page ? { ...page } : emptyBookingPage());
    setPanel("details");
    setDirty(false);
    setReady(false);
    const timer = setTimeout(() => setReady(true), 380);
    return () => clearTimeout(timer);
  }, [page]);

  const edit = (patch: Partial<BookingPage>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const questions = (draft.questions || []) as BookingPageQuestion[];
  const hosts = draft.hosts || [];
  const accent = draft.color || "#635BFF";

  const videoOptions = useMemo(
    () => connections.filter((item) => item.category === "video" && item.status === "connected"),
    [connections],
  );

  const leave = () => {
    setLeaving(true);
    setTimeout(onClose, 320);
  };
  const requestClose = () => (dirty ? setConfirmingExit(true) : leave());

  const save = () => {
    setDirty(false);
    onSave(draft);
  };

  const updateQuestion = (id: string, patch: Partial<BookingPageQuestion>) =>
    edit({ questions: questions.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const next = [...questions];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    edit({ questions: next });
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs transition-opacity duration-200 sm:p-4 lg:p-6",
        leaving ? "opacity-0" : "opacity-100",
      )}
    >
      <div
        role="region"
        aria-label="Booking page builder"
        className={cn(
          "flex h-full max-h-[min(940px,100%)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl transition-all duration-200",
          leaving ? "scale-[.985] opacity-0" : "scale-100 opacity-100",
        )}
      >
        {!ready ? (
          <div
            role="status"
            aria-label="Opening the booking page builder"
            className="flex flex-1 flex-col items-center justify-center gap-3"
          >
            <span className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
            <p className="text-[12px] font-medium text-muted-foreground">Opening the builder…</p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Exit builder"
                onClick={requestClose}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Booking page name"
                  value={draft.name || ""}
                  onChange={(event) => edit({ name: event.target.value })}
                  placeholder="Intro call"
                  className="h-8 max-w-[420px] border-0 px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
                />
                <p className="text-[10px] text-muted-foreground">
                  {page ? "Editing booking page" : "New booking page"}
                  {dirty ? (
                    <span className="ml-1.5 text-amber-600 dark:text-amber-400">· Unsaved changes</span>
                  ) : null}
                </p>
              </div>
              <Select
                value={draft.status || "draft"}
                onValueChange={(value) => edit({ status: value as BookingPage["status"] })}
              >
                <SelectTrigger className="h-9 w-[130px] text-[12px]" aria-label="Publish state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !(draft.name || "").trim()}
                onClick={save}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save booking page
              </Button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_minmax(340px,.85fr)]">
              {/* Setup rail */}
              <aside className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain border-b border-border bg-card p-3 lg:border-b-0 lg:border-r">
                <div className="flex flex-wrap gap-1">
                  {panels.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setPanel(item.key)}
                      aria-pressed={panel === item.key}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                        panel === item.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-4">
                  {panel === "details" ? (
                    <>
                      <Field label="Description">
                        <Textarea
                          value={draft.description || ""}
                          onChange={(event) => edit({ description: event.target.value })}
                          placeholder="A relaxed first conversation."
                          className="min-h-[80px] text-[12px]"
                        />
                      </Field>
                      <Field label="Duration">
                        <Select
                          value={String(draft.durationMinutes || 30)}
                          onValueChange={(value) => edit({ durationMinutes: Number(value) })}
                        >
                          <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[15, 20, 30, 45, 60, 90, 120].map((minutes) => (
                              <SelectItem key={minutes} value={String(minutes)}>
                                {minutes} minutes
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Location">
                        <Select
                          value={draft.locationType || "video"}
                          onValueChange={(value) =>
                            edit({ locationType: value as BookingPage["locationType"] })
                          }
                        >
                          <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(locationLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      {draft.locationType === "video" ? (
                        <Field label="Meeting link from">
                          {videoOptions.length ? (
                            <Select
                              value={draft.videoProvider || ""}
                              onValueChange={(value) => edit({ videoProvider: value })}
                            >
                              <SelectTrigger className="h-9 text-[12px]">
                                <SelectValue placeholder="Choose a connected provider" />
                              </SelectTrigger>
                              <SelectContent>
                                {videoOptions.map((item) => (
                                  <SelectItem key={item.provider} value={item.provider}>
                                    <span className="flex items-center gap-2">
                                      <ProviderLogo provider={item.provider} className="h-3.5 w-3.5" />
                                      {item.accountLabel || item.provider}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px] leading-4 text-muted-foreground">
                              No video provider is connected yet. Connect Zoom, Google Meet, or
                              Teams on the Integrations tab and a link will be generated for every
                              booking.
                            </p>
                          )}
                        </Field>
                      ) : draft.locationType === "in_person" ? (
                        <Field label="Address">
                          <Input
                            value={draft.locationDetail || ""}
                            onChange={(event) => edit({ locationDetail: event.target.value })}
                            placeholder="12 Marina Road, Lagos"
                            className="h-9 text-[12px]"
                          />
                        </Field>
                      ) : draft.locationType === "phone" ? (
                        <Field label="Who calls whom">
                          <Input
                            value={draft.locationDetail || ""}
                            onChange={(event) => edit({ locationDetail: event.target.value })}
                            placeholder="We will call the number you provide"
                            className="h-9 text-[12px]"
                          />
                        </Field>
                      ) : null}
                    </>
                  ) : null}

                  {panel === "hosts" ? (
                    <>
                      <Field label="Scheduling type">
                        <Select
                          value={draft.schedulingType || "single"}
                          onValueChange={(value) =>
                            edit({ schedulingType: value as BookingPage["schedulingType"] })
                          }
                        >
                          <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(schedulingLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                          {draft.schedulingType === "round_robin"
                            ? "Bookings are shared out between hosts in turn."
                            : draft.schedulingType === "collective"
                              ? "Every host must be free for a slot to be offered."
                              : draft.schedulingType === "group"
                                ? "Several invitees can take the same slot, up to the capacity below."
                                : "One host owns every booking on this page."}
                        </p>
                      </Field>
                      {draft.schedulingType === "group" ? (
                        <Field label="Capacity per slot">
                          <Input
                            type="number"
                            min={1}
                            value={draft.capacity ?? 1}
                            onChange={(event) => edit({ capacity: Number(event.target.value) || 1 })}
                            className="h-9 text-[12px]"
                          />
                        </Field>
                      ) : null}
                      <Field label="Hosts">
                        <div className="space-y-2">
                          {hosts.map((host, index) => (
                            <div key={host.id} className="flex gap-1.5">
                              <Input
                                value={host.name}
                                onChange={(event) =>
                                  edit({
                                    hosts: hosts.map((item, position) =>
                                      position === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                    ),
                                  })
                                }
                                placeholder="Name"
                                className="h-8 text-[11px]"
                              />
                              <Input
                                value={host.email}
                                onChange={(event) =>
                                  edit({
                                    hosts: hosts.map((item, position) =>
                                      position === index
                                        ? { ...item, email: event.target.value }
                                        : item,
                                    ),
                                  })
                                }
                                placeholder="email@company.com"
                                className="h-8 text-[11px]"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-destructive"
                                aria-label={`Remove host ${host.name || index + 1}`}
                                onClick={() =>
                                  edit({ hosts: hosts.filter((_item, position) => position !== index) })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 w-full text-[11px]"
                            onClick={() =>
                              edit({ hosts: [...hosts, { id: fieldId(), name: "", email: "" }] })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" /> Add host
                          </Button>
                        </div>
                      </Field>
                    </>
                  ) : null}

                  {panel === "questions" ? (
                    <div className="space-y-2">
                      {questions.map((question, index) => (
                        <div key={question.id} className="rounded-md border border-border p-2.5">
                          <div className="flex items-center gap-1.5">
                            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Input
                              value={question.label}
                              onChange={(event) =>
                                updateQuestion(question.id, { label: event.target.value })
                              }
                              placeholder="Question"
                              className="h-8 text-[11px]"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive"
                              aria-label={`Remove ${question.label || "question"}`}
                              onClick={() =>
                                edit({ questions: questions.filter((item) => item.id !== question.id) })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <Select
                              value={question.type}
                              onValueChange={(value) => updateQuestion(question.id, { type: value })}
                            >
                              <SelectTrigger className="h-7 flex-1 text-[10px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <Switch
                                checked={Boolean(question.required)}
                                onCheckedChange={(checked) =>
                                  updateQuestion(question.id, { required: checked })
                                }
                              />
                              Required
                            </label>
                            <div className="flex gap-0.5">
                              <Button
                                type="button" variant="ghost" size="icon" className="h-7 w-7"
                                aria-label="Move question up"
                                disabled={index === 0}
                                onClick={() => moveQuestion(index, -1)}
                              >↑</Button>
                              <Button
                                type="button" variant="ghost" size="icon" className="h-7 w-7"
                                aria-label="Move question down"
                                disabled={index === questions.length - 1}
                                onClick={() => moveQuestion(index, 1)}
                              >↓</Button>
                            </div>
                          </div>
                          {question.type === "dropdown" ? (
                            <Input
                              value={(question.options || []).join(", ")}
                              onChange={(event) =>
                                updateQuestion(question.id, {
                                  options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                })
                              }
                              placeholder="Option one, Option two"
                              className="mt-2 h-7 text-[10px]"
                            />
                          ) : null}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full text-[11px]"
                        onClick={() =>
                          edit({
                            questions: [
                              ...questions,
                              { id: fieldId(), type: "short_text", label: "", required: false },
                            ],
                          })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add question
                      </Button>
                    </div>
                  ) : null}

                  {panel === "branding" ? (
                    <>
                      <Field label="Accent colour">
                        <input
                          type="color"
                          aria-label="Accent colour"
                          value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#635BFF"}
                          onChange={(event) => edit({ color: event.target.value })}
                          className="h-9 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                      </Field>
                      <Field label="Welcome message">
                        <Textarea
                          value={draft.branding?.welcomeMessage || ""}
                          onChange={(event) =>
                            edit({ branding: { ...draft.branding, welcomeMessage: event.target.value } })
                          }
                          placeholder="Looking forward to speaking with you."
                          className="min-h-[70px] text-[12px]"
                        />
                      </Field>
                      <Field label="Cover image URL">
                        <Input
                          value={draft.branding?.coverImage || ""}
                          onChange={(event) =>
                            edit({ branding: { ...draft.branding, coverImage: event.target.value } })
                          }
                          placeholder="https://…"
                          className="h-9 text-[12px]"
                        />
                      </Field>
                    </>
                  ) : null}

                  {panel === "payment" ? (
                    <>
                      <Field label="Price">
                        <div className="flex gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={((draft.priceCents || 0) / 100).toFixed(2)}
                            onChange={(event) =>
                              edit({ priceCents: Math.round(Number(event.target.value) * 100) || 0 })
                            }
                            className="h-9 text-[12px]"
                          />
                          <Select
                            value={draft.currency || "USD"}
                            onValueChange={(value) => edit({ currency: value })}
                          >
                            <SelectTrigger className="h-9 w-[92px] text-[12px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["USD", "EUR", "GBP", "NGN", "KES", "ZAR"].map((code) => (
                                <SelectItem key={code} value={code}>{code}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </Field>
                      <p className="rounded-md border border-border bg-muted/30 p-2.5 text-[10px] leading-4 text-muted-foreground">
                        Leave the price at zero for a free booking. A paid booking is only confirmed
                        once payment clears, using the provider configured in Payments.
                      </p>
                    </>
                  ) : null}
                </div>
              </aside>

              {/* Canvas summary */}
              <main className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain border-b border-border p-5 lg:border-b-0">
                <div className="mx-auto max-w-[560px] space-y-3">
                  <SummaryRow icon={Clock3} label="Duration" value={`${draft.durationMinutes || 30} minutes`} />
                  <SummaryRow
                    icon={draft.locationType === "in_person" ? MapPin : Video}
                    label="Location"
                    value={
                      locationLabels[draft.locationType || "video"] +
                      (draft.videoProvider ? ` · ${draft.videoProvider.replace(/_/g, " ")}` : "") +
                      (draft.locationDetail ? ` · ${draft.locationDetail}` : "")
                    }
                  />
                  <SummaryRow
                    icon={Users}
                    label="Scheduling"
                    value={
                      schedulingLabels[draft.schedulingType || "single"] +
                      (draft.schedulingType === "group" ? ` · up to ${draft.capacity || 1}` : "") +
                      (hosts.length ? ` · ${hosts.length} host${hosts.length === 1 ? "" : "s"}` : "")
                    }
                  />
                  <SummaryRow
                    icon={CalendarDays}
                    label="Price"
                    value={draft.priceCents ? money(draft.priceCents, draft.currency) : "Free"}
                  />
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Booking form
                    </p>
                    {questions.length ? (
                      <ul className="mt-3 space-y-2">
                        {questions.map((question) => (
                          <li key={question.id} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="min-w-0 truncate">
                              {question.label || <span className="text-muted-foreground">Untitled question</span>}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {FIELD_TYPES.find((type) => type.value === question.type)?.label}
                              {question.required ? " · required" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        No questions yet. Invitees will only be asked for a time.
                      </p>
                    )}
                  </div>
                </div>
              </main>

              {/* Live preview of the public page */}
              <aside className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain bg-muted/30 p-4 lg:border-l lg:border-border">
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="text-[11px] font-semibold">Live preview</p>
                  <Badge variant="outline" className="text-[9px]">Public page</Badge>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
                  {draft.branding?.coverImage ? (
                    <img
                      src={draft.branding.coverImage}
                      alt=""
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="h-2" style={{ backgroundColor: accent }} />
                  )}
                  <div className="p-4">
                    <h3 className="text-[16px] font-semibold leading-tight">
                      {draft.name || "Untitled booking page"}
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />{draft.durationMinutes || 30} min
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Video className="h-3 w-3" />{locationLabels[draft.locationType || "video"]}
                      </span>
                      {draft.priceCents ? (
                        <span className="font-medium text-foreground">
                          {money(draft.priceCents, draft.currency)}
                        </span>
                      ) : null}
                    </p>
                    {draft.description ? (
                      <p className="mt-2.5 text-[12px] leading-5 text-muted-foreground">
                        {draft.description}
                      </p>
                    ) : null}
                    {draft.branding?.welcomeMessage ? (
                      <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] leading-4">
                        {draft.branding.welcomeMessage}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-4 gap-1.5">
                      {["Mon", "Tue", "Wed", "Thu"].map((day) => (
                        <div key={day} className="rounded-md border border-border p-1.5 text-center">
                          <p className="text-[9px] text-muted-foreground">{day}</p>
                          <p className="text-[12px] font-semibold">—</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[9px] text-muted-foreground">
                      Real slots come from your Availability rules.
                    </p>

                    {questions.length ? (
                      <div className="mt-4 space-y-2.5 border-t border-border pt-3">
                        {questions.map((question) => (
                          <div key={question.id}>
                            <p className="text-[10px] font-medium">
                              {question.label || "Untitled question"}
                              {question.required ? <span style={{ color: accent }}> *</span> : null}
                            </p>
                            <div className="mt-1 h-7 rounded-md border border-border bg-muted/40" />
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div
                      className="mt-4 rounded-md py-2 text-center text-[12px] font-semibold text-white"
                      style={{ backgroundColor: accent }}
                    >
                      Confirm booking
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}

        <Dialog open={confirmingExit} onOpenChange={(value) => !value && setConfirmingExit(false)}>
          <DialogContent className="max-w-[430px]">
            <DialogHeader>
              <DialogTitle>Leave without saving?</DialogTitle>
              <DialogDescription>
                {draft.name || "This booking page"} has unsaved changes. Closing now discards them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmingExit(false)}>
                Keep editing
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => { setConfirmingExit(false); setDirty(false); leave(); }}
              >
                Discard changes
              </Button>
              <Button
                type="button"
                disabled={saving || !(draft.name || "").trim()}
                onClick={() => { setConfirmingExit(false); save(); }}
              >
                Save and close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">{label}</p>
        <p className="truncate text-[13px] font-medium">{value}</p>
      </div>
    </div>
  );
}
