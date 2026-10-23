import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { BookingPage, BookingPageQuestion, RoutingForm, RoutingRule } from "@/lib/appointments";
import { resolveRoute } from "./routing";

/**
 * Routing form editor.
 *
 * A routing form is a form whose submit action is "show this booking page", so
 * the editor is questions on the left and rules on the right. The tester at the
 * bottom runs the same engine the server runs, which is what makes a rule set
 * checkable before it is ever published.
 */
const fieldId = () => `q${Math.random().toString(36).slice(2, 9)}`;

export function RoutingFormEditor({
  bookingPages,
  form,
  onClose,
  onSave,
  saving,
}: {
  bookingPages: BookingPage[];
  form: RoutingForm | null;
  onClose: () => void;
  onSave: (input: Partial<RoutingForm>) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Partial<RoutingForm>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useScrollLock(true);

  useEffect(() => {
    setDraft(
      form || {
        name: "",
        description: "",
        questions: [{ id: fieldId(), type: "dropdown", label: "What do you need help with?", options: [] }],
        routingRules: [],
        fallbackBookingPageId: null,
        status: "draft",
      },
    );
    setAnswers({});
    setReady(false);
    const timer = setTimeout(() => setReady(true), 340);
    return () => clearTimeout(timer);
  }, [form]);

  const questions = (draft.questions || []) as BookingPageQuestion[];
  const rules = (draft.routingRules || []) as RoutingRule[];
  const edit = (patch: Partial<RoutingForm>) => setDraft((current) => ({ ...current, ...patch }));

  const preview = resolveRoute(rules, answers, draft.fallbackBookingPageId || null);
  const previewPage = bookingPages.find((page) => page.id === preview.bookingPageId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs sm:p-4 lg:p-6">
      <div
        role="region"
        aria-label="Routing form editor"
        className="flex h-full max-h-[min(940px,100%)] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        {!ready ? (
          <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-[12px] text-muted-foreground">Opening the routing form…</p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
              <Button
                type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                aria-label="Exit routing form editor" onClick={onClose}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Input
                aria-label="Routing form name"
                value={draft.name || ""}
                onChange={(event) => edit({ name: event.target.value })}
                placeholder="Qualify before booking"
                className="h-8 max-w-[380px] flex-1 border-0 px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
              />
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Switch
                  checked={draft.status === "live"}
                  onCheckedChange={(checked) => edit({ status: checked ? "live" : "draft" })}
                />
                Live
              </label>
              <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                type="button" size="sm"
                disabled={saving || !(draft.name || "").trim()}
                onClick={() => onSave(draft)}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save routing form
              </Button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_320px]">
              <section className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain border-b border-border p-4 lg:border-b-0 lg:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Questions
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Asked before any time slot is shown.
                </p>
                <div className="mt-3 space-y-2">
                  {questions.map((question) => (
                    <div key={question.id} className="rounded-md border border-border p-2.5">
                      <div className="flex gap-1.5">
                        <Input
                          value={question.label}
                          onChange={(event) =>
                            edit({
                              questions: questions.map((item) =>
                                item.id === question.id ? { ...item, label: event.target.value } : item,
                              ),
                            })
                          }
                          placeholder="Question"
                          className="h-8 text-[11px]"
                        />
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          aria-label={`Remove ${question.label || "question"}`}
                          onClick={() =>
                            edit({ questions: questions.filter((item) => item.id !== question.id) })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={(question.options || []).join(", ")}
                        onChange={(event) =>
                          edit({
                            questions: questions.map((item) =>
                              item.id === question.id
                                ? {
                                    ...item,
                                    options: event.target.value
                                      .split(",").map((option) => option.trim()).filter(Boolean),
                                  }
                                : item,
                            ),
                          })
                        }
                        placeholder="Answer options, comma separated"
                        className="mt-2 h-7 text-[10px]"
                      />
                      <p className="mt-1.5 text-[9px] text-muted-foreground">
                        Field key <code className="font-mono">{question.id}</code>
                      </p>
                    </div>
                  ))}
                  <Button
                    type="button" variant="outline" size="sm" className="h-8 w-full text-[11px]"
                    onClick={() =>
                      edit({
                        questions: [
                          ...questions,
                          { id: fieldId(), type: "dropdown", label: "", options: [] },
                        ],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add question
                  </Button>
                </div>
              </section>

              <section className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain border-b border-border p-4 lg:border-b-0 lg:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Routing rules
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Checked top to bottom — the first match wins.
                </p>
                <div className="mt-3 space-y-2">
                  {rules.map((rule, index) => (
                    <div key={rule.id} className="rounded-md border border-border p-2.5">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[9px]">Rule {index + 1}</Badge>
                        <Button
                          type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          aria-label={`Remove rule ${index + 1}`}
                          onClick={() => edit({ routingRules: rules.filter((item) => item.id !== rule.id) })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
                        <Select
                          value={rule.field}
                          onValueChange={(value) =>
                            edit({
                              routingRules: rules.map((item) =>
                                item.id === rule.id ? { ...item, field: value } : item,
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="h-7 text-[10px]">
                            <SelectValue placeholder="Question" />
                          </SelectTrigger>
                          <SelectContent>
                            {questions.map((question) => (
                              <SelectItem key={question.id} value={question.id}>
                                {question.label || question.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={rule.operator}
                          onValueChange={(value) =>
                            edit({
                              routingRules: rules.map((item) =>
                                item.id === rule.id
                                  ? { ...item, operator: value as RoutingRule["operator"] }
                                  : item,
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="h-7 w-[104px] text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equals">is</SelectItem>
                            <SelectItem value="not_equals">is not</SelectItem>
                            <SelectItem value="contains">contains</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        value={rule.value}
                        onChange={(event) =>
                          edit({
                            routingRules: rules.map((item) =>
                              item.id === rule.id ? { ...item, value: event.target.value } : item,
                            ),
                          })
                        }
                        placeholder="Answer to match"
                        className="mt-1.5 h-7 text-[10px]"
                      />
                      <Select
                        value={rule.bookingPageId}
                        onValueChange={(value) =>
                          edit({
                            routingRules: rules.map((item) =>
                              item.id === rule.id ? { ...item, bookingPageId: value } : item,
                            ),
                          })
                        }
                      >
                        <SelectTrigger className="mt-1.5 h-7 text-[10px]">
                          <SelectValue placeholder="→ send to booking page" />
                        </SelectTrigger>
                        <SelectContent>
                          {bookingPages.map((page) => (
                            <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <Button
                    type="button" variant="outline" size="sm" className="h-8 w-full text-[11px]"
                    disabled={!questions.length || !bookingPages.length}
                    onClick={() =>
                      edit({
                        routingRules: [
                          ...rules,
                          {
                            id: fieldId(),
                            field: questions[0]?.id || "",
                            operator: "equals",
                            value: "",
                            bookingPageId: bookingPages[0]?.id || "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add rule
                  </Button>
                  {!bookingPages.length ? (
                    <p className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 text-[10px] leading-4 text-muted-foreground">
                      Create a booking page first — a rule has to have somewhere to send people.
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 space-y-1.5 border-t border-border pt-3">
                  <Label className="text-[11px]">If nothing matches, send to</Label>
                  <Select
                    value={draft.fallbackBookingPageId || ""}
                    onValueChange={(value) => edit({ fallbackBookingPageId: value })}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue placeholder="Choose a default booking page" />
                    </SelectTrigger>
                    <SelectContent>
                      {bookingPages.map((page) => (
                        <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <aside className="dashboard-scroll min-h-0 overflow-y-auto overscroll-contain bg-muted/30 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Test the routing
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Answer as a visitor would and see where they land.
                </p>
                <div className="mt-3 space-y-2.5">
                  {questions.map((question) => (
                    <div key={question.id} className="space-y-1">
                      <Label className="text-[10px]">{question.label || question.id}</Label>
                      {question.options?.length ? (
                        <Select
                          value={answers[question.id] || ""}
                          onValueChange={(value) =>
                            setAnswers((current) => ({ ...current, [question.id]: value }))
                          }
                        >
                          <SelectTrigger className="h-8 text-[11px]">
                            <SelectValue placeholder="Choose" />
                          </SelectTrigger>
                          <SelectContent>
                            {question.options.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={answers[question.id] || ""}
                          onChange={(event) =>
                            setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                          }
                          className="h-8 text-[11px]"
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div
                  className={cn(
                    "mt-4 rounded-lg border p-3",
                    previewPage ? "border-primary/30 bg-primary/5" : "border-border bg-background",
                  )}
                >
                  <p className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">Routes to</p>
                  <p className="mt-1 text-[13px] font-semibold">
                    {previewPage ? previewPage.name : "Nowhere yet"}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {preview.matchedRuleId
                      ? `Matched rule ${rules.findIndex((rule) => rule.id === preview.matchedRuleId) + 1}`
                      : previewPage
                        ? "Fell through to the default page"
                        : "No rule matched and no default is set"}
                  </p>
                </div>
                <Textarea
                  readOnly
                  value={draft.description || ""}
                  onChange={(event) => edit({ description: event.target.value })}
                  className="mt-3 hidden"
                />
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
