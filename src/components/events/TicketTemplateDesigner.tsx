import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Barcode,
  Building2,
  CalendarDays,
  Clock,
  Copy,
  FileText,
  Grid3x3,
  Hash,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  LockKeyhole,
  Magnet,
  Mail,
  MapPin,
  Minus,
  MousePointer2,
  Plus,
  QrCode,
  Receipt,
  Redo2,
  Save,
  Square,
  Ticket,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import type {
  EventTicketDesignTemplate,
  TicketCanvasElement,
  TicketElementStyle,
  TicketElementType,
} from "@/components/events/event-types";
import {
  TICKET_ELEMENT_LABELS,
  approximateHeight,
  clampElement,
  cleanElementStyle,
  defaultSizeFor,
  defaultWidthFor,
  hasCaption,
  isBoundElement,
  layoutKeyFor,
  round,
  type TicketSide,
} from "@/components/events/ticket-designer-model";
import { TicketSurface } from "@/components/events/ticket-surface";
import {
  ColorControl,
  EditorSection,
  SegmentedControl,
  SpacingControlGroup,
  StyleNumberInput,
} from "@/components/shared/StyleControls";
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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveEventTicketDesignTemplate } from "@/lib/events";
import { uploadFileToStorage } from "@/lib/storage";
import {
  TICKET_MOTIFS,
  sampleTicketNumber,
  sampleTicketResolver,
  type TicketElementResolver,
} from "@/lib/ticket-theme";
import { cn } from "@/lib/utils";

const ELEMENT_ICONS: Record<TicketElementType, LucideIcon> = {
  event_name: Type,
  event_tagline: Type,
  event_details: CalendarDays,
  event_date: CalendarDays,
  event_time: Clock,
  venue: MapPin,
  address: MapPin,
  organizer: Building2,
  attendee_name: UserRound,
  attendee_email: Mail,
  ticket_type: Ticket,
  ticket_price: Receipt,
  ticket_number: Hash,
  order_code: Hash,
  event_code: Hash,
  qr: QrCode,
  barcode: Barcode,
  logo: ImagePlus,
  image: Images,
  custom_text: Type,
  terms: FileText,
  panel: Square,
  divider: Minus,
};

const PALETTE: Array<{ group: string; items: TicketElementType[] }> = [
  {
    group: "Event",
    items: [
      "event_name",
      "event_tagline",
      "event_date",
      "event_time",
      "venue",
      "address",
      "organizer",
      "event_details",
      "event_code",
    ],
  },
  {
    group: "Attendee & ticket",
    items: [
      "attendee_name",
      "attendee_email",
      "ticket_price",
      "ticket_number",
      "order_code",
    ],
  },
  { group: "Codes", items: ["qr", "barcode"] },
  { group: "Media & copy", items: ["logo", "image", "custom_text", "terms"] },
  { group: "Decoration", items: ["panel", "divider"] },
];

const THEME_PALETTES: Array<{
  name: string;
  background: string;
  accent: string;
  text: string;
  muted: string;
}> = [
  { name: "Editorial slate", background: "#F7F9FC", accent: "#2457E6", text: "#111827", muted: "#526071" },
  { name: "Midnight rose", background: "#0B0B0D", accent: "#F43F5E", text: "#FFFFFF", muted: "#A1A1AA" },
  { name: "Champagne", background: "#FFFCF5", accent: "#9A6A12", text: "#262117", muted: "#766A54" },
  { name: "Forest", background: "#F4F8F1", accent: "#297A57", text: "#173D2D", muted: "#5E746A" },
  { name: "Sunset", background: "#FFF7ED", accent: "#EA580C", text: "#431407", muted: "#9A3412" },
  { name: "Carbon gold", background: "#18181B", accent: "#D4AF37", text: "#FAFAFA", muted: "#A1A1AA" },
  { name: "Electric violet", background: "#0A0714", accent: "#8B5CF6", text: "#F5F3FF", muted: "#A5A0C0" },
  { name: "Studio mono", background: "#FFFFFF", accent: "#18181B", text: "#09090B", muted: "#71717A" },
];

const SNAP_TOLERANCE = 0.8;
const NUDGE = 0.5;

const readImageFile = async (file: File) => {
  const stored = await uploadFileToStorage(file, {
    purpose: "ticket_asset",
    visibility: "public",
  });
  if (!stored.url) throw new Error("The public ticket image URL is unavailable.");
  return stored.url;
};

type DragState = {
  elementId: string;
  mode: "move" | "resize-left" | "resize-right";
  pointerId: number;
  originX: number;
  originY: number;
  startElement: TicketCanvasElement;
  surfaceWidth: number;
  surfaceHeight: number;
};

type Guides = { x: number[]; y: number[] };

/** Snaps a moving edge to the canvas thirds and to other elements' edges. */
const snapValue = (
  candidates: number[],
  targets: number[],
  enabled: boolean,
) => {
  if (!enabled) return { delta: 0, hit: null as number | null };
  let best: { delta: number; hit: number } | null = null;
  for (const candidate of candidates) {
    for (const target of targets) {
      const delta = target - candidate;
      if (Math.abs(delta) > SNAP_TOLERANCE) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, hit: target };
      }
    }
  }
  return best ? { delta: best.delta, hit: best.hit } : { delta: 0, hit: null };
};

export function TicketTemplateDesigner({
  onBack,
  onSaved,
  onSaveTemplate,
  saveLabel = "Save template",
  saveSuccessMessage = "Ticket template saved",
  leaveDescription = "Your ticket template has changes that are not in the database.",
  template,
  ticketTypeNames = [],
  userId,
}: {
  onBack: () => void;
  onSaved: (template: EventTicketDesignTemplate) => void;
  onSaveTemplate?: (
    template: EventTicketDesignTemplate,
  ) => Promise<EventTicketDesignTemplate>;
  saveLabel?: string;
  saveSuccessMessage?: string;
  leaveDescription?: string;
  template: EventTicketDesignTemplate;
  ticketTypeNames?: string[];
  userId: string;
}) {
  const [draft, setDraft] = useState(() => structuredClone(template));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [past, setPast] = useState<EventTicketDesignTemplate[]>([]);
  const [future, setFuture] = useState<EventTicketDesignTemplate[]>([]);
  const [side, setSide] = useState<TicketSide>("front");
  const [selectedId, setSelectedId] = useState(
    template.frontLayout.find((element) => element.type === "event_name")?.id ||
      template.frontLayout[0]?.id ||
      "",
  );
  const [panel, setPanel] = useState<"element" | "template">("element");
  const [rail, setRail] = useState<"layers" | "add">("layers");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [pendingUploads, setPendingUploads] = useState(0);
  const availableTicketTypes = useMemo(
    () => [...new Set(ticketTypeNames.map((name) => name.trim()).filter(Boolean))],
    [ticketTypeNames],
  );
  const previewTicketType = availableTicketTypes[0] || "General admission";
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutKey = layoutKeyFor(side);
  const elements = draft[layoutKey];
  const selected =
    elements.find((element) => element.id === selectedId) || null;
  const resolveTicketPreview: TicketElementResolver = useCallback(
    (element) =>
      element.type === "ticket_type"
        ? { caption: element.label, text: previewTicketType }
        : sampleTicketResolver(element),
    [previewTicketType],
  );

  const finishElementUpload = useCallback(
    (id: string, changes: Partial<TicketCanvasElement>) => {
      setDraft((current) => {
        const key = current.frontLayout.some((element) => element.id === id)
          ? "frontLayout"
          : current.backLayout.some((element) => element.id === id)
            ? "backLayout"
            : null;
        if (!key) return current;
        const next = {
          ...current,
          [key]: current[key].map((element) =>
            element.id === id
              ? clampElement({ ...element, ...changes })
              : element,
          ),
        };
        draftRef.current = next;
        return next;
      });
      setDirty(true);
    },
    [],
  );
  const finishThemeUpload = useCallback(
    (backgroundImage: string) => {
      setDraft((current) => {
        const next = {
          ...current,
          theme: { ...current.theme, backgroundImage },
        };
        draftRef.current = next;
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const commit = useCallback(
    (next: EventTicketDesignTemplate) => {
      setPast((history) => [...history.slice(-49), draft]);
      setFuture([]);
      setDraft(next);
      setDirty(true);
    },
    [draft],
  );

  const updateLayout = useCallback(
    (layout: TicketCanvasElement[]) => commit({ ...draft, [layoutKey]: layout }),
    [commit, draft, layoutKey],
  );

  const patchElement = useCallback(
    (id: string, changes: Partial<TicketCanvasElement>) =>
      updateLayout(
        elements.map((element) =>
          element.id === id ? clampElement({ ...element, ...changes }) : element,
        ),
      ),
    [elements, updateLayout],
  );

  const patchStyle = useCallback(
    (id: string, changes: TicketElementStyle) => {
      const current = elements.find((element) => element.id === id);
      if (!current) return;
      patchElement(id, {
        style: cleanElementStyle({ ...(current.style || {}), ...changes }),
      });
    },
    [elements, patchElement],
  );

  const undo = useCallback(() => {
    setPast((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setFuture((forward) => [draft, ...forward].slice(0, 50));
      setDraft(previous);
      setDirty(true);
      return history.slice(0, -1);
    });
  }, [draft]);

  const redo = useCallback(() => {
    setFuture((forward) => {
      if (!forward.length) return forward;
      setPast((history) => [...history, draft]);
      setDraft(forward[0]);
      setDirty(true);
      return forward.slice(1);
    });
  }, [draft]);

  const addElement = useCallback(
    (type: TicketElementType, position?: { x: number; y: number }) => {
      const width = defaultWidthFor(type);
      const element = clampElement({
        id: `${type}-${crypto.randomUUID()}`,
        type,
        label: TICKET_ELEMENT_LABELS[type],
        x: position ? position.x - width / 2 : 7,
        y: position ? position.y : Math.min(84, 12 + elements.length * 9),
        width,
        size: defaultSizeFor(type),
        align: "left",
      });
      updateLayout([...elements, element]);
      setSelectedId(element.id);
      setPanel("element");
    },
    [elements, updateLayout],
  );

  const duplicateElement = useCallback(
    (id: string) => {
      const source = elements.find((element) => element.id === id);
      if (!source) return;
      const copy = clampElement({
        ...structuredClone(source),
        id: `${source.type}-${crypto.randomUUID()}`,
        x: source.x + 3,
        y: source.y + 5,
      });
      updateLayout([...elements, copy]);
      setSelectedId(copy.id);
    },
    [elements, updateLayout],
  );

  const removeElement = useCallback(
    (id: string) => {
      const target = elements.find((element) => element.id === id);
      if (!target) return;
      if (target.type === "qr" && side === "front") {
        toast.error("The secure QR has to stay on the front of the ticket.");
        return;
      }
      updateLayout(elements.filter((element) => element.id !== id));
      setSelectedId("");
    },
    [elements, side, updateLayout],
  );

  const reorderElement = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = elements.findIndex((element) => element.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= elements.length) return;
      const next = [...elements];
      [next[index], next[target]] = [next[target], next[index]];
      updateLayout(next);
    },
    [elements, updateLayout],
  );

  // Selection frame is measured from the DOM: an element's height comes from
  // its content, so it cannot be derived from the layout numbers alone.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !selectedId) {
      setSelectionBox(null);
      return;
    }
    const measure = () => {
      const node = surface.querySelector<HTMLElement>(
        `[data-ticket-element="${CSS.escape(selectedId)}"]`,
      );
      if (!node) {
        setSelectionBox(null);
        return;
      }
      const surfaceRect = surface.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      setSelectionBox({
        left: rect.left - surfaceRect.left,
        top: rect.top - surfaceRect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [draft, selectedId, side]);

  const beginDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    element: TicketCanvasElement,
    mode: DragState["mode"],
  ) => {
    const surface = surfaceRef.current;
    if (!surface || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = surface.getBoundingClientRect();
    setSelectedId(element.id);
    setPanel("element");
    stageRef.current?.focus();
    setPast((history) => [...history.slice(-49), draft]);
    setFuture([]);
    dragRef.current = {
      elementId: element.id,
      mode,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startElement: { ...element },
      surfaceWidth: rect.width,
      surfaceHeight: rect.height,
    };
  };

  useEffect(() => {
    if (!dragRef.current) return undefined;
    const handleMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const deltaX =
        ((event.clientX - state.originX) / state.surfaceWidth) * 100;
      const deltaY =
        ((event.clientY - state.originY) / state.surfaceHeight) * 100;
      const start = state.startElement;
      const others = elements.filter((item) => item.id !== state.elementId);
      const targetsX = [50, ...others.flatMap((item) => [
        item.x,
        item.x + item.width / 2,
        item.x + item.width,
      ])];
      const targetsY = [50, ...others.flatMap((item) => [
        item.y,
        item.y + approximateHeight(item),
      ])];

      let next: TicketCanvasElement;
      const hits: Guides = { x: [], y: [] };

      if (state.mode === "move") {
        let x = start.x + deltaX;
        let y = start.y + deltaY;
        const snapX = snapValue(
          [x, x + start.width / 2, x + start.width],
          targetsX,
          snapEnabled,
        );
        const snapY = snapValue(
          [y, y + approximateHeight(start)],
          targetsY,
          snapEnabled,
        );
        x += snapX.delta;
        y += snapY.delta;
        if (snapX.hit != null) hits.x.push(snapX.hit);
        if (snapY.hit != null) hits.y.push(snapY.hit);
        next = { ...start, x: round(x), y: round(y) };
      } else if (state.mode === "resize-right") {
        const width = start.width + deltaX;
        const snapX = snapValue([start.x + width], targetsX, snapEnabled);
        if (snapX.hit != null) hits.x.push(snapX.hit);
        next = { ...start, width: round(width + snapX.delta) };
      } else {
        const x = start.x + deltaX;
        const snapX = snapValue([x], targetsX, snapEnabled);
        if (snapX.hit != null) hits.x.push(snapX.hit);
        const nextX = x + snapX.delta;
        next = {
          ...start,
          x: round(nextX),
          width: round(start.width + (start.x - nextX)),
        };
      }

      setGuides(hits);
      const clamped = clampElement(next);
      setDraft((current) => ({
        ...current,
        [layoutKey]: current[layoutKey].map((item) =>
          item.id === state.elementId ? clamped : item,
        ),
      }));
      setDirty(true);
    };
    const handleUp = () => {
      dragRef.current = null;
      setGuides({ x: [], y: [] });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  });

  const dropFromPalette = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(
      "application/maxform-ticket-element",
) as TicketElementType;
    if (!type || !TICKET_ELEMENT_LABELS[type]) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addElement(type, {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  const onStageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!selected) return;
    const step = event.shiftKey ? NUDGE * 8 : NUDGE;
    const nudge = (x: number, y: number) => {
      event.preventDefault();
      patchElement(selected.id, { x: round(selected.x + x), y: round(selected.y + y) });
    };
    if (event.key === "ArrowLeft") nudge(-step, 0);
    else if (event.key === "ArrowRight") nudge(step, 0);
    else if (event.key === "ArrowUp") nudge(0, -step);
    else if (event.key === "ArrowDown") nudge(0, step);
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeElement(selected.id);
    } else if (event.key === "Escape") setSelectedId("");
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateElement(selected.id);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
  };

  const save = async () => {
    if (savingRef.current || !dirty || pendingUploads > 0) return false;
    savingRef.current = true;
    setSaving(true);
    let deadlineId: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        deadlineId = setTimeout(
          () => reject(new Error("Saving took too long. Please try again.")),
          12_000,
        );
      });
      // Arm the deadline before invoking the parent save callback. This also
      // converts a synchronous callback failure into the normal error path.
      const saveRequest = Promise.resolve().then(() => {
        const snapshot = structuredClone(draftRef.current);
        return onSaveTemplate
          ? onSaveTemplate(snapshot)
          : saveEventTicketDesignTemplate(userId, snapshot);
      });
      const saved = await Promise.race([saveRequest, deadline]);
      setDraft(saved);
      draftRef.current = saved;
      setPast([]);
      setFuture([]);
      setDirty(false);
      // Clear the button immediately. Parent refreshes and success messages
      // must never leave the editor looking as though it is still saving.
      savingRef.current = false;
      setSaving(false);
      onSaved(saved);
      toast.success(saveSuccessMessage);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The ticket template could not be saved.",
      );
      return false;
    } finally {
      if (deadlineId) clearTimeout(deadlineId);
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const alignSelected = (mode: "left" | "center" | "right" | "middle") => {
    if (!selected) return;
    if (mode === "middle") {
      patchElement(selected.id, {
        y: round(50 - approximateHeight(selected) / 2),
      });
      return;
    }
    const x =
      mode === "left" ? 7 : mode === "center" ? 50 - selected.width / 2 : 93 - selected.width;
    patchElement(selected.id, { x: round(x) });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <DesignerTopBar
        dirty={dirty}
        draft={draft}
        onBack={() => (dirty ? setLeaveOpen(true) : onBack())}
        onNameChange={(name) => commit({ ...draft, name })}
        onRedo={redo}
        onSave={() => void save()}
        onSideChange={(next) => {
          setSide(next);
          setSelectedId(draft[layoutKeyFor(next)][0]?.id || "");
        }}
        onUndo={undo}
        redoDisabled={!future.length}
        saving={saving}
        saveLabel={saveLabel}
        side={side}
        undoDisabled={!past.length}
        uploading={pendingUploads > 0}
      />

      <div className="mt-6 grid gap-5 xl:grid-cols-[236px_minmax(0,1fr)_324px]">
        <aside className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-1 border-b border-border p-1.5">
            {(
              [
                ["layers", "Layers"],
                ["add", "Add element"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRail(value)}
                className={cn(
                  "h-8 flex-1 rounded-md text-[12px] transition",
                  rail === value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="dashboard-scroll max-h-[calc(100vh-270px)] overflow-y-auto p-4">
            {rail === "layers" ? (
              <LayerList
                elements={elements}
                onDuplicate={duplicateElement}
                onRemove={removeElement}
                onReorder={reorderElement}
                onSelect={(id) => {
                  setSelectedId(id);
                  setPanel("element");
                }}
                selectedId={selectedId}
                side={side}
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Purchase data
                  </p>
                  <button
                    type="button"
                    draggable
                    data-ticket-tool="ticket_type"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        "application/maxform-ticket-element",
                        "ticket_type",
                      );
                    }}
                    onClick={() => addElement("ticket_type")}
                    className="group w-full rounded-xl border border-primary/25 bg-primary/[0.04] p-3 text-left transition hover:border-primary/50 hover:bg-primary/[0.07]"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Ticket className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-semibold">
                          Purchased ticket type
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                          Automatically shows VIP, General Admission, or the tier purchased.
                        </span>
                      </span>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-primary">
                        Dynamic
                      </span>
                    </span>
                  </button>
                </div>
                {PALETTE.map((group) => (
                  <div key={group.group}>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.group}
                    </p>
                    <div className="grid gap-1">
                      {group.items.map((type) => {
                        const Icon = ELEMENT_ICONS[type];
                        return (
                          <button
                            key={type}
                            type="button"
                            draggable
                            data-ticket-tool={type}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData(
                                "application/maxform-ticket-element",
                                type,
                              );
                            }}
                            onClick={() => addElement(type)}
                            className="flex min-h-8 items-center gap-2.5 rounded-md border border-transparent px-2 text-left text-[12px] text-muted-foreground transition hover:border-border hover:bg-accent hover:text-foreground"
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {TICKET_ELEMENT_LABELS[type]}
                            </span>
                            <Plus className="ml-auto h-3 w-3 shrink-0 opacity-50" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <IconToggle
                active={showGrid}
                icon={Grid3x3}
                label="Grid"
                onClick={() => setShowGrid((value) => !value)}
              />
              <IconToggle
                active={snapEnabled}
                icon={Magnet}
                label="Snap to guides"
                onClick={() => setSnapEnabled((value) => !value)}
              />
              <span className="mx-1 h-5 w-px bg-border" />
              <IconToggle
                disabled={!selected}
                icon={AlignLeft}
                label="Align left"
                onClick={() => alignSelected("left")}
              />
              <IconToggle
                disabled={!selected}
                icon={AlignCenter}
                label="Center horizontally"
                onClick={() => alignSelected("center")}
              />
              <IconToggle
                disabled={!selected}
                icon={AlignRight}
                label="Align right"
                onClick={() => alignSelected("right")}
              />
              <IconToggle
                disabled={!selected}
                icon={MousePointer2}
                label="Center vertically"
                onClick={() => alignSelected("middle")}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Drag to move · arrow keys nudge · ⌘D duplicates
            </p>
          </div>

          <div
            ref={stageRef}
            tabIndex={0}
            onKeyDown={onStageKeyDown}
            className="rounded-xl bg-muted/30 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-5"
          >
            <div className="mx-auto w-full max-w-[980px]">
              <TicketSurface
                elements={elements}
                flat
                interactive
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={dropFromPalette}
                onElementPointerDown={(event, element) =>
                  beginDrag(event, element, "move")
                }
                onSurfacePointerDown={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "[data-ticket-element]",
                    )
                  ) {
                    setSelectedId("");
                  }
                  stageRef.current?.focus();
                }}
                overlay={
                  <CanvasOverlay
                    guides={guides}
                    onResizePointerDown={(event, mode) =>
                      selected && beginDrag(event, selected, mode)
                    }
                    selectionBox={selectionBox}
                    showGrid={showGrid}
                  />
                }
                qrValue={`MAXFORM:TEMPLATE:${draft.id || "NEW"}:SECURE`}
                resolve={resolveTicketPreview}
                selectedId={selectedId}
                side={side}
                surfaceRef={surfaceRef}
                theme={draft.theme}
                ticketNumber={sampleTicketNumber}
              />
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Sample content is shown while designing. Issued tickets use the live
            event, attendee, and ticket record.
          </p>
        </section>

        <aside className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-muted/25 p-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-background/70 p-1">
            {(
              [
                ["element", "Block settings"],
                ["template", "Ticket style"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPanel(value)}
                className={cn(
                  "h-9 rounded-lg px-2 text-[11px] font-medium transition",
                  panel === value
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            </div>
          </div>
          <div className="dashboard-scroll max-h-[calc(100vh-260px)] overflow-y-auto">
            {panel === "element" ? (
              <ElementInspector
                element={selected}
                onFinishUpload={finishElementUpload}
                onPatch={(changes) =>
                  selected && patchElement(selected.id, changes)
                }
                onStyle={(changes) => selected && patchStyle(selected.id, changes)}
                onUploadStateChange={(uploading) =>
                  setPendingUploads((current) =>
                    Math.max(0, current + (uploading ? 1 : -1)),
                  )
                }
                theme={draft.theme}
                previewTicketType={previewTicketType}
              />
            ) : (
              <TemplateInspector
                draft={draft}
                onFinishUpload={finishThemeUpload}
                onChange={(next) => commit(next)}
                onUploadStateChange={(uploading) =>
                  setPendingUploads((current) =>
                    Math.max(0, current + (uploading ? 1 : -1)),
                  )
                }
              />
            )}
          </div>
        </aside>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              {leaveDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLeaveOpen(false)}
            >
              Keep editing
            </Button>
            <Button type="button" variant="destructive" onClick={onBack}>
              Discard changes
            </Button>
            <Button
              type="button"
              disabled={pendingUploads > 0}
              onClick={() =>
                void save().then((saved) => {
                  if (!saved) return;
                  setLeaveOpen(false);
                  onBack();
                })
              }
            >
              <Save className="h-4 w-4" />
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function DesignerTopBar({
  dirty,
  draft,
  onBack,
  onNameChange,
  onRedo,
  onSave,
  onSideChange,
  onUndo,
  redoDisabled,
  saving,
  saveLabel,
  side,
  undoDisabled,
  uploading,
}: {
  dirty: boolean;
  draft: EventTicketDesignTemplate;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onRedo: () => void;
  onSave: () => void;
  onSideChange: (side: TicketSide) => void;
  onUndo: () => void;
  redoDisabled: boolean;
  saving: boolean;
  saveLabel: string;
  side: TicketSide;
  undoDisabled: boolean;
  uploading: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to ticket templates</span>
        </Button>
        <div className="min-w-0">
          <Input
            value={draft.name}
            onChange={(event) => onNameChange(event.target.value)}
            aria-label="Template name"
            className="h-9 max-w-[320px] border-transparent bg-transparent px-2 text-[18px] font-semibold shadow-none hover:border-border focus-visible:border-input"
          />
          <p className="mt-0.5 flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
            <span>{draft.category || "Custom"}</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <LockKeyhole className="h-3 w-3" />
              Secure QR locked
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-1">
          {(["front", "back"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSideChange(value)}
              className={cn(
                "rounded px-4 py-1.5 text-[12px] capitalize transition",
                side === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <IconToggle
            disabled={undoDisabled}
            icon={Undo2}
            label="Undo"
            onClick={onUndo}
          />
          <IconToggle
            disabled={redoDisabled}
            icon={Redo2}
            label="Redo"
            onClick={onRedo}
          />
        </div>
        <span className="ml-1 text-[11px] text-muted-foreground">
          {uploading ? "Uploading artwork..." : dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || uploading || !dirty}
          loading={saving}
          loadingLabel={`Saving ${saveLabel.toLowerCase()}`}
          className={cn(!dirty && "bg-muted text-muted-foreground")}
        >
          <Save className="h-4 w-4" />
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

function IconToggle({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-pressed={active}
          className={cn(
            "grid h-8 w-8 place-items-center rounded-md border transition disabled:opacity-40",
            active
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CanvasOverlay({
  guides,
  onResizePointerDown,
  selectionBox,
  showGrid,
}: {
  guides: Guides;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    mode: "resize-left" | "resize-right",
  ) => void;
  selectionBox: { left: number; top: number; width: number; height: number } | null;
  showGrid: boolean;
}) {
  return (
    <>
      {showGrid && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(99,102,241,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.16) 1px, transparent 1px)",
            backgroundSize: "10% 18%",
          }}
        />
      )}
      {guides.x.map((position) => (
        <div
          key={`x-${position}`}
          className="pointer-events-none absolute inset-y-0 w-px bg-fuchsia-500"
          style={{ left: `${position}%` }}
        />
      ))}
      {guides.y.map((position) => (
        <div
          key={`y-${position}`}
          className="pointer-events-none absolute inset-x-0 h-px bg-fuchsia-500"
          style={{ top: `${position}%` }}
        />
      ))}
      {selectionBox && (
        <div
          className="pointer-events-none absolute rounded-[3px] ring-2 ring-primary"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        >
          {(["resize-left", "resize-right"] as const).map((mode) => (
            <div
              key={mode}
              role="presentation"
              onPointerDown={(event) => onResizePointerDown(event, mode)}
              className={cn(
                "pointer-events-auto absolute top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-primary bg-background shadow-sm",
                mode === "resize-left" ? "-left-1.5" : "-right-1.5",
              )}
            />
          ))}
        </div>
      )}
    </>
  );
}

function LayerList({
  elements,
  onDuplicate,
  onRemove,
  onReorder,
  onSelect,
  selectedId,
  side,
}: {
  elements: TicketCanvasElement[];
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
  onSelect: (id: string) => void;
  selectedId: string;
  side: TicketSide;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        Layers · {side}
      </h3>
      <div className="mt-3 space-y-1">
        {[...elements].reverse().map((element) => {
          const Icon = ELEMENT_ICONS[element.type];
          const active = element.id === selectedId;
          const locked = element.type === "qr" && side === "front";
          return (
            <div
              key={element.id}
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 transition",
                active
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:border-border hover:bg-accent",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(element.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">
                    {element.label || TICKET_ELEMENT_LABELS[element.type]}
                  </span>
                  <span className="block truncate text-[9px] uppercase text-muted-foreground">
                    {TICKET_ELEMENT_LABELS[element.type]}
                  </span>
                </span>
                {locked && (
                  <LockKeyhole className="h-3 w-3 shrink-0 text-emerald-600" />
                )}
              </button>
              <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={`Move ${element.label} up`}
                  onClick={() => onReorder(element.id, 1)}
                  className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${element.label} down`}
                  onClick={() => onReorder(element.id, -1)}
                  className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${element.label}`}
                  onClick={() => onDuplicate(element.id)}
                  className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${element.label}`}
                  disabled={locked}
                  onClick={() => onRemove(element.id)}
                  className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          );
        })}
        {!elements.length && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] leading-5 text-muted-foreground">
            Nothing on this side yet. Add an element from the list above.
          </p>
        )}
      </div>
    </section>
  );
}

function ElementInspector({
  element,
  onFinishUpload,
  onPatch,
  onStyle,
  onUploadStateChange,
  previewTicketType,
  theme,
}: {
  element: TicketCanvasElement | null;
  onFinishUpload: (
    id: string,
    changes: Partial<TicketCanvasElement>,
  ) => void;
  onPatch: (changes: Partial<TicketCanvasElement>) => void;
  onStyle: (changes: TicketElementStyle) => void;
  onUploadStateChange: (uploading: boolean) => void;
  previewTicketType: string;
  theme: EventTicketDesignTemplate["theme"];
}) {
  const inputId = useMemo(() => `ticket-element-${element?.id || "none"}`, [element?.id]);
  const [uploadingImage, setUploadingImage] = useState(false);

  if (!element) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
        <MousePointer2 className="h-5 w-5 text-muted-foreground" />
        <p className="mt-3 text-[13px] font-medium">Select an element</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Click a block on the ticket or pick a layer to edit its content,
          typography, color, and spacing.
        </p>
      </div>
    );
  }

  const style = element.style || {};
  const Icon = ELEMENT_ICONS[element.type];
  const isMedia = element.type === "logo" || element.type === "image";
  const isQr = element.type === "qr";
  const editableCopy = element.type === "custom_text" || element.type === "terms";

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    const elementId = element.id;
    const previousValue = element.value || "";
    const previewUrl = URL.createObjectURL(file);
    onPatch({ value: previewUrl });
    setUploadingImage(true);
    onUploadStateChange(true);
    try {
      const uploadedUrl = await readImageFile(file);
      onFinishUpload(elementId, { value: uploadedUrl });
    } catch (error) {
      onFinishUpload(elementId, { value: previousValue });
      toast.error(
        error instanceof Error ? error.message : "The image could not upload.",
      );
    } finally {
      URL.revokeObjectURL(previewUrl);
      setUploadingImage(false);
      onUploadStateChange(false);
    }
  };

  return (
    <div>
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-muted/60 text-foreground shadow-sm">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">
            {TICKET_ELEMENT_LABELS[element.type]}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {round(element.x)}% × {round(element.y)}% · {round(element.width)}%
            wide
          </p>
        </div>
        {isQr && (
          <span className="ml-auto flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-[9px] text-emerald-700 dark:text-emerald-400">
            <LockKeyhole className="h-3 w-3" />
            Locked
          </span>
        )}
      </header>

      <EditorSection
        title="Content"
        description={
          isBoundElement(element)
            ? "The value is filled from the live event, attendee, or ticket."
            : undefined
        }
      >
        <div className="space-y-4">
          {element.type === "ticket_type" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Ticket className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold">Live purchase field</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      This block automatically prints the exact ticket tier selected at checkout.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/35 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Automatic preview
                  </p>
                  <p className="truncate text-sm font-semibold">{previewTicketType}</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Live data
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${inputId}-caption`}>Caption</Label>
                <Input
                  id={`${inputId}-caption`}
                  value={element.label}
                  onChange={(event) => onPatch({ label: event.target.value })}
                  placeholder="Ticket type"
                />
              </div>
            </div>
          ) : isMedia ? (
            <>
              {element.value && (
                <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30 p-2">
                  <img
                    src={element.value}
                    alt=""
                    className={cn(
                      "max-h-full max-w-full",
                      element.type === "logo"
                        ? "object-contain"
                        : "h-full w-full object-cover",
                    )}
                  />
                </div>
              )}
              <input
                id={`${inputId}-file`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  void uploadImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingImage}
                  asChild={!uploadingImage}
                >
                  {uploadingImage ? (
                    <span>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Uploading
                    </span>
                  ) : (
                    <label htmlFor={`${inputId}-file`} className="cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      {element.value ? "Replace" : "Upload"}
                    </label>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!element.value}
                  onClick={() => onPatch({ value: "" })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </>
          ) : editableCopy ? (
            <div className="space-y-2">
              <Label htmlFor={`${inputId}-copy`}>Text</Label>
              <Textarea
                id={`${inputId}-copy`}
                value={element.label}
                onChange={(event) => onPatch({ label: event.target.value })}
                className="min-h-[92px]"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`${inputId}-caption`}>Caption</Label>
              <Input
                id={`${inputId}-caption`}
                value={element.label}
                onChange={(event) => onPatch({ label: event.target.value })}
                disabled={isQr}
                placeholder="Attendee, Ticket type..."
              />
            </div>
          )}

          {hasCaption(element) && (
            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span className="text-[11px] text-muted-foreground">
                Show the caption above the value
              </span>
              <input
                type="checkbox"
                checked={!style.hideCaption}
                onChange={(event) =>
                  onStyle({ hideCaption: !event.target.checked })
                }
                className="h-4 w-4 accent-primary"
              />
            </label>
          )}
        </div>
      </EditorSection>

      {!isQr && !isMedia && (
        <EditorSection title="Typography">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Font</Label>
                <Select
                  value={style.fontFamily || "inherit"}
                  onValueChange={(fontFamily) =>
                    onStyle({
                      fontFamily: fontFamily as TicketElementStyle["fontFamily"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Template default</SelectItem>
                    <SelectItem value="sans">Inter (sans)</SelectItem>
                    <SelectItem value="display">Geist (display)</SelectItem>
                    <SelectItem value="serif">Serif</SelectItem>
                    <SelectItem value="mono">Monospace</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Weight</Label>
                <Select
                  value={String(style.fontWeight || "")}
                  onValueChange={(weight) =>
                    onStyle({ fontWeight: weight ? Number(weight) : undefined })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {[300, 400, 500, 600, 700, 800].map((weight) => (
                      <SelectItem key={weight} value={String(weight)}>
                        {weight}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Size preset</Label>
              <SegmentedControl
                ariaLabel="Text size preset"
                onChange={(size) =>
                  onPatch({ size: size as TicketCanvasElement["size"] })
                }
                options={[
                  { value: "small", label: "Small" },
                  { value: "medium", label: "Medium" },
                  { value: "large", label: "Large" },
                ]}
                value={element.size || "small"}
              />
            </div>

            <SliderRow
              label="Fine size"
              max={250}
              min={50}
              onChange={(fontScale) => onStyle({ fontScale })}
              step={5}
              suffix="%"
              value={style.fontScale ?? 100}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <StyleNumberInput
                id={`${inputId}-tracking`}
                label="Letter spacing"
                min={-10}
                max={60}
                placeholder="0"
                unit="/100em"
                value={style.letterSpacing}
                onChange={(letterSpacing) => onStyle({ letterSpacing })}
              />
              <StyleNumberInput
                id={`${inputId}-leading`}
                label="Line height"
                min={80}
                max={260}
                placeholder="Auto"
                unit="%"
                value={style.lineHeight}
                onChange={(lineHeight) => onStyle({ lineHeight })}
              />
            </div>

            <div className="space-y-2">
              <Label>Capitalization</Label>
              <SegmentedControl
                ariaLabel="Capitalization"
                onChange={(textTransform) =>
                  onStyle({
                    textTransform:
                      textTransform as TicketElementStyle["textTransform"],
                  })
                }
                options={[
                  { value: "none", label: "Aa" },
                  { value: "uppercase", label: "AA" },
                  { value: "lowercase", label: "aa" },
                  { value: "capitalize", label: "Ab" },
                ]}
                value={style.textTransform || "none"}
              />
            </div>

            <div className="space-y-2">
              <Label>Alignment</Label>
              <SegmentedControl
                ariaLabel="Text alignment"
                onChange={(align) =>
                  onPatch({ align: align as TicketCanvasElement["align"] })
                }
                options={[
                  { value: "left", label: <AlignLeft className="h-3.5 w-3.5" />, title: "Left" },
                  { value: "center", label: <AlignCenter className="h-3.5 w-3.5" />, title: "Center" },
                  { value: "right", label: <AlignRight className="h-3.5 w-3.5" />, title: "Right" },
                ]}
                value={element.align || "left"}
              />
            </div>
          </div>
        </EditorSection>
      )}

      <EditorSection title="Color & border">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isQr && !isMedia && (
              <ColorControl
                id={`${inputId}-text-color`}
                label="Text"
                fallback={theme.text}
                value={style.textColor}
                onChange={(textColor) => onStyle({ textColor })}
              />
            )}
            {hasCaption(element) && (
              <ColorControl
                id={`${inputId}-caption-color`}
                label="Caption"
                fallback={theme.muted}
                value={style.captionColor}
                onChange={(captionColor) => onStyle({ captionColor })}
              />
            )}
            <ColorControl
              id={`${inputId}-background`}
              label="Background"
              fallback={theme.accent}
              value={style.backgroundColor}
              onChange={(backgroundColor) => onStyle({ backgroundColor })}
            />
            <ColorControl
              id={`${inputId}-border-color`}
              label="Border"
              fallback={theme.accent}
              value={style.borderColor}
              onChange={(borderColor) => onStyle({ borderColor })}
            />
          </div>
          <SliderRow
            label="Background opacity"
            max={100}
            min={0}
            onChange={(backgroundOpacity) => onStyle({ backgroundOpacity })}
            step={5}
            suffix="%"
            value={style.backgroundOpacity ?? 100}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <StyleNumberInput
              id={`${inputId}-border-width`}
              label="Border width"
              max={10}
              placeholder="0"
              value={style.borderWidth}
              onChange={(borderWidth) => onStyle({ borderWidth })}
            />
            <StyleNumberInput
              id={`${inputId}-radius`}
              label="Corner radius"
              max={48}
              placeholder="0"
              value={style.borderRadius}
              onChange={(borderRadius) => onStyle({ borderRadius })}
            />
          </div>
        </div>
      </EditorSection>

      <EditorSection
        title="Spacing"
        description="Padding sits inside the block. Margin nudges it away from its anchor."
      >
        <div className="space-y-4">
          <SpacingControlGroup
            baseId={`${inputId}-padding`}
            label="Padding"
            max={48}
            placeholder="0"
            values={{
              top: style.paddingTop,
              right: style.paddingRight,
              bottom: style.paddingBottom,
              left: style.paddingLeft,
            }}
            onChange={(sideKey, value) =>
              onStyle({ [`padding${sideKey}`]: value } as TicketElementStyle)
            }
          />
          <SpacingControlGroup
            baseId={`${inputId}-margin`}
            label="Margin"
            max={48}
            min={-48}
            placeholder="0"
            values={{
              top: style.marginTop,
              right: style.marginRight,
              bottom: style.marginBottom,
              left: style.marginLeft,
            }}
            onChange={(sideKey, value) =>
              onStyle({ [`margin${sideKey}`]: value } as TicketElementStyle)
            }
          />
        </div>
      </EditorSection>

      <EditorSection title="Position & size">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <StyleNumberInput
              id={`${inputId}-x`}
              label="X"
              max={100}
              step={0.5}
              unit="%"
              value={round(element.x)}
              onChange={(x) => onPatch({ x: x ?? 0 })}
            />
            <StyleNumberInput
              id={`${inputId}-y`}
              label="Y"
              max={100}
              step={0.5}
              unit="%"
              value={round(element.y)}
              onChange={(y) => onPatch({ y: y ?? 0 })}
            />
            <StyleNumberInput
              id={`${inputId}-width`}
              label="Width"
              max={100}
              min={6}
              step={0.5}
              unit="%"
              value={round(element.width)}
              onChange={(width) => onPatch({ width: width ?? 20 })}
            />
          </div>
          <SliderRow
            label="Rotation"
            max={30}
            min={-30}
            onChange={(rotation) => onStyle({ rotation })}
            step={1}
            suffix="°"
            value={style.rotation ?? 0}
          />
          <SliderRow
            label="Opacity"
            max={100}
            min={10}
            onChange={(opacity) => onStyle({ opacity })}
            step={5}
            suffix="%"
            value={style.opacity ?? 100}
          />
        </div>
      </EditorSection>
    </div>
  );
}

function SliderRow({
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-[11px] text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}

function TemplateInspector({
  draft,
  onChange,
  onFinishUpload,
  onUploadStateChange,
}: {
  draft: EventTicketDesignTemplate;
  onChange: (next: EventTicketDesignTemplate) => void;
  onFinishUpload: (backgroundImage: string) => void;
  onUploadStateChange: (uploading: boolean) => void;
}) {
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const setTheme = (patch: Partial<EventTicketDesignTemplate["theme"]>) =>
    onChange({ ...draft, theme: { ...draft.theme, ...patch } });

  const uploadBackground = async (file: File) => {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    const previousValue = draft.theme.backgroundImage || "";
    const previewUrl = URL.createObjectURL(file);
    setTheme({ backgroundImage: previewUrl });
    setUploadingBackground(true);
    onUploadStateChange(true);
    try {
      onFinishUpload(await readImageFile(file));
    } catch (error) {
      onFinishUpload(previousValue);
      toast.error(
        error instanceof Error
          ? error.message
          : "The background artwork could not upload.",
      );
    } finally {
      URL.revokeObjectURL(previewUrl);
      setUploadingBackground(false);
      onUploadStateChange(false);
    }
  };

  return (
    <div>
      <EditorSection title="Template details">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticket-template-name">Name</Label>
            <Input
              id="ticket-template-name"
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-template-category">Category</Label>
            <Input
              id="ticket-template-category"
              value={draft.category}
              onChange={(event) =>
                onChange({ ...draft, category: event.target.value })
              }
              placeholder="Conference, Concert, VIP..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-template-description">Description</Label>
            <Textarea
              id="ticket-template-description"
              value={draft.description}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
              className="min-h-[84px]"
            />
          </div>
        </div>
      </EditorSection>

      <EditorSection title="Palette">
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {THEME_PALETTES.map((palette) => {
              const active =
                draft.theme.background.toUpperCase() ===
                  palette.background.toUpperCase() &&
                draft.theme.accent.toUpperCase() === palette.accent.toUpperCase();
              return (
                <button
                  key={palette.name}
                  type="button"
                  title={palette.name}
                  aria-label={`${palette.name} palette`}
                  onClick={() =>
                    setTheme({
                      background: palette.background,
                      accent: palette.accent,
                      text: palette.text,
                      muted: palette.muted,
                    })
                  }
                  className={cn(
                    "flex h-9 items-center gap-1 rounded-md border p-1.5 transition",
                    active
                      ? "border-primary ring-1 ring-primary"
                      : "border-input hover:border-primary/50",
                  )}
                >
                  <span
                    className="h-full flex-1 rounded-sm"
                    style={{ backgroundColor: palette.background }}
                  />
                  <span
                    className="h-full w-2 rounded-sm"
                    style={{ backgroundColor: palette.accent }}
                  />
                  <span
                    className="h-full w-1.5 rounded-sm"
                    style={{ backgroundColor: palette.text }}
                  />
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorControl
              id="ticket-theme-background"
              label="Background"
              fallback="#FFFFFF"
              value={draft.theme.background}
              onChange={(background) => setTheme({ background })}
            />
            <ColorControl
              id="ticket-theme-accent"
              label="Accent"
              fallback="#65758B"
              value={draft.theme.accent}
              onChange={(accent) => setTheme({ accent })}
            />
            <ColorControl
              id="ticket-theme-text"
              label="Text"
              fallback="#18181B"
              value={draft.theme.text}
              onChange={(text) => setTheme({ text })}
            />
            <ColorControl
              id="ticket-theme-muted"
              label="Muted"
              fallback="#71717A"
              value={draft.theme.muted}
              onChange={(muted) => setTheme({ muted })}
            />
          </div>
        </div>
      </EditorSection>

      <EditorSection title="Ticket stock">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Background pattern</Label>
            <Select
              value={draft.theme.motif}
              onValueChange={(motif) => setTheme({ motif })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_MOTIFS.map((motif) => (
                  <SelectItem key={motif.value} value={motif.value}>
                    {motif.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ticket edge</Label>
            <Select
              value={draft.theme.edge}
              onValueChange={(edge: EventTicketDesignTemplate["theme"]["edge"]) =>
                setTheme({ edge })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solid">Solid edge</SelectItem>
                <SelectItem value="perforated">
                  Perforated tear-off stub
                </SelectItem>
                <SelectItem value="double">Double frame</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-background-image">Background artwork</Label>
            {draft.theme.backgroundImage && (
              <div className="aspect-[1.8/1] overflow-hidden rounded-md border border-border bg-muted/30">
                <img
                  src={draft.theme.backgroundImage}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <input
              id="ticket-background-image"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void uploadBackground(file);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingBackground}
                asChild={!uploadingBackground}
              >
                {uploadingBackground ? (
                  <span>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Uploading
                  </span>
                ) : (
                  <label
                    htmlFor="ticket-background-image"
                    className="cursor-pointer"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {draft.theme.backgroundImage ? "Replace" : "Upload"}
                  </label>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!draft.theme.backgroundImage}
                onClick={() => setTheme({ backgroundImage: "" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      </EditorSection>
    </div>
  );
}
