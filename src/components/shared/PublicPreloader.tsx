import { useState, type ChangeEvent } from "react";
import {
  CircleDashed,
  Eye,
  Loader2,
  Orbit,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import {
  normalizePreloaderSettings,
  type PreloaderSettings,
} from "@/components/shared/preloader-config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";
import { uploadFileToStorage } from "@/lib/storage";

const preloaderIconOptions: Array<{
  value: PreloaderSettings["icon"];
  label: string;
}> = [
  { value: "spinner", label: "Classic spinner" },
  { value: "circle", label: "Dashed circle" },
  { value: "orbit", label: "Orbit" },
  { value: "refresh", label: "Refresh loop" },
  { value: "dots", label: "Bouncing dots" },
];

function PreloaderIconMark({ settings }: { settings: PreloaderSettings }) {
  const size = `min(${settings.iconSize}px, 22vw)`;
  const style = { color: settings.iconColor, height: size, width: size };
  if (settings.icon === "dots") {
    return (
      <span className="flex items-center justify-center gap-1.5" aria-label="Loading">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-2.5 w-2.5 animate-bounce rounded-full"
            style={{
              animationDelay: `${dot * 140}ms`,
              backgroundColor: settings.iconColor,
            }}
          />
        ))}
      </span>
    );
  }
  const Icon =
    settings.icon === "circle"
      ? CircleDashed
      : settings.icon === "orbit"
        ? Orbit
        : settings.icon === "refresh"
          ? RefreshCw
          : Loader2;
  return <Icon className="animate-spin" style={style} aria-label="Loading" />;
}

export function PublicPreloader({
  settings,
  className,
  preview = false,
}: {
  settings: PreloaderSettings | undefined | null;
  className?: string;
  preview?: boolean;
}) {
  const preloader = normalizePreloaderSettings(settings);
  return (
    <section
      className={cn(
        "grid w-full place-items-center overflow-hidden px-4 py-7 text-center sm:px-6",
        preview ? "min-h-[410px]" : "min-h-dvh",
        className,
      )}
      style={{ backgroundColor: preloader.backgroundColor }}
      aria-live="polite"
      aria-label="Loading"
    >
      <div
        className="w-full max-w-[min(100%,30rem)]"
        style={{
          backgroundColor: preloader.cardBackgroundColor,
          border: `${preloader.borderWidth}px solid ${preloader.cardBorderColor}`,
          borderRadius: preloader.borderRadius,
          padding: `clamp(1.25rem, 5vw, ${preloader.padding}px)`,
        }}
      >
        {preloader.imageUrl && (
          <img
            src={preloader.imageUrl}
            alt=""
            className="mx-auto object-contain"
            style={{
              height: `min(${preloader.imageSize}px, 28vw)`,
              maxWidth: "100%",
              width: `min(${preloader.imageSize}px, 60vw)`,
            }}
          />
        )}
        <div className={cn("flex justify-center", preloader.imageUrl && "mt-5")}>
          <PreloaderIconMark settings={preloader} />
        </div>
        {preloader.title && (
          <h1
            className="mt-5 break-words font-semibold leading-tight"
            style={{
              color: preloader.titleColor,
              fontSize: `min(${preloader.titleFontSize}px, 7vw)`,
            }}
          >
            {preloader.title}
          </h1>
        )}
        {preloader.description && (
          <p
            className="mx-auto mt-2 max-w-[34ch] break-words leading-6"
            style={{
              color: preloader.descriptionColor,
              fontSize: `min(${preloader.descriptionFontSize}px, 5vw)`,
            }}
          >
            {preloader.description}
          </p>
        )}
      </div>
    </section>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-text`}>{label}</Label>
      <div className="flex gap-2">
        <input
          id={`${id}-picker`}
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-1"
          aria-label={`${label} picker`}
        />
        <Input
          id={`${id}-text`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#FFFFFF"
          maxLength={24}
        />
      </div>
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  suffix = "px",
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-[11px] text-muted-foreground">
          {value}{suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

export function PreloaderSettingsEditor({
  settings,
  onChange,
  storagePurpose = "form_asset",
  idPrefix = "preloader",
  title = "Public preloader",
  description = "Show a responsive, centered loading screen before the public page opens.",
}: {
  settings: PreloaderSettings | undefined | null;
  onChange: (settings: PreloaderSettings) => void;
  storagePurpose?: "form_asset" | "event_asset";
  idPrefix?: string;
  title?: string;
  description?: string;
}) {
  const [imageError, setImageError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const preloader = normalizePreloaderSettings(settings);
  const update = (patch: Partial<PreloaderSettings>) =>
    onChange(normalizePreloaderSettings({ ...preloader, ...patch }));
  const uploadImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Choose an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImageError("Use an image smaller than 2 MB.");
      return;
    }
    void uploadFileToStorage(file, {
      purpose: storagePurpose,
      visibility: "public",
    })
      .then((stored) => {
        if (!stored.url) throw new Error("The public image URL is unavailable.");
        update({ imageUrl: stored.url });
        setImageError("");
      })
      .catch((error) =>
        setImageError(
          error instanceof Error
            ? error.message
            : "The image could not be uploaded.",
        ),
      );
  };

  return (
    <div className="grid gap-8 py-7 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
          <div>
            <h2 className="text-[18px] font-semibold">{title}</h2>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
          <Switch
            checked={preloader.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
            aria-label="Enable public preloader"
          />
        </div>

        <div className={cn("space-y-6 py-6", !preloader.enabled && "opacity-60")}>
          <section className="border-b border-border pb-6">
            <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
              Timing and message
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-duration`}>Display time (seconds)</Label>
                <Input
                  id={`${idPrefix}-duration`}
                  type="number"
                  min="0"
                  max="30"
                  step="0.1"
                  value={preloader.durationSeconds}
                  onChange={(event) => update({ durationSeconds: Number(event.target.value) })}
                />
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Use 0 for no added wait. The public page opens as soon as it loads.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Loading icon</Label>
                <Select
                  value={preloader.icon}
                  onValueChange={(icon: PreloaderSettings["icon"]) => update({ icon })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {preloaderIconOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-5 w-5 items-center justify-center">
                            <PreloaderIconMark
                              settings={{
                                ...preloader,
                                icon: option.value,
                                iconSize: 18,
                              }}
                            />
                          </span>
                          {option.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor={`${idPrefix}-title`}>Preloader text</Label>
                <Input
                  id={`${idPrefix}-title`}
                  value={preloader.title}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder="Getting things ready"
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor={`${idPrefix}-description`}>Description</Label>
                <Textarea
                  id={`${idPrefix}-description`}
                  value={preloader.description}
                  onChange={(event) => update({ description: event.target.value })}
                  className="min-h-[86px]"
                  placeholder="Please wait a moment."
                />
              </div>
            </div>
          </section>

          <section className="border-b border-border pb-6">
            <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">Image or logo</h3>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" asChild>
                <label htmlFor={`${idPrefix}-image-upload`} className="cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {preloader.imageUrl ? "Replace image" : "Upload image"}
                </label>
              </Button>
              {preloader.imageUrl && (
                <Button type="button" variant="outline" size="icon" onClick={() => update({ imageUrl: "" })} aria-label="Remove preloader image">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <input
              id={`${idPrefix}-image-upload`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={uploadImage}
              className="sr-only"
            />
            {preloader.imageUrl && (
              <div className="mt-4 flex h-28 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/20 p-3">
                <img src={preloader.imageUrl} alt="Preloader logo preview" className="h-full max-w-full object-contain" />
              </div>
            )}
            {imageError && <p className="mt-2 text-[11px] text-destructive">{imageError}</p>}
          </section>

          <section className="border-b border-border pb-6">
            <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">Content style</h3>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <ColorField id={`${idPrefix}-icon-color`} label="Icon color" value={preloader.iconColor} onChange={(iconColor) => update({ iconColor })} />
              <RangeField id={`${idPrefix}-icon-size`} label="Icon size" value={preloader.iconSize} min={16} max={112} onChange={(iconSize) => update({ iconSize })} />
              <ColorField id={`${idPrefix}-title-color`} label="Text color" value={preloader.titleColor} onChange={(titleColor) => update({ titleColor })} />
              <RangeField id={`${idPrefix}-title-size`} label="Text size" value={preloader.titleFontSize} min={12} max={42} onChange={(titleFontSize) => update({ titleFontSize })} />
              <ColorField id={`${idPrefix}-description-color`} label="Description color" value={preloader.descriptionColor} onChange={(descriptionColor) => update({ descriptionColor })} />
              <RangeField id={`${idPrefix}-description-size`} label="Description size" value={preloader.descriptionFontSize} min={10} max={28} onChange={(descriptionFontSize) => update({ descriptionFontSize })} />
              <div className="sm:col-span-2">
                <RangeField id={`${idPrefix}-image-size`} label="Image size" value={preloader.imageSize} min={24} max={180} onChange={(imageSize) => update({ imageSize })} />
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">Container style</h3>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <ColorField id={`${idPrefix}-page-bg`} label="Page background" value={preloader.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
              <ColorField id={`${idPrefix}-card-bg`} label="Container background" value={preloader.cardBackgroundColor} onChange={(cardBackgroundColor) => update({ cardBackgroundColor })} />
              <ColorField id={`${idPrefix}-card-border`} label="Container border" value={preloader.cardBorderColor} onChange={(cardBorderColor) => update({ cardBorderColor })} />
              <RangeField id={`${idPrefix}-border-width`} label="Border width" value={preloader.borderWidth} min={0} max={12} onChange={(borderWidth) => update({ borderWidth })} />
              <RangeField id={`${idPrefix}-radius`} label="Corner radius" value={preloader.borderRadius} min={0} max={48} onChange={(borderRadius) => update({ borderRadius })} />
              <RangeField id={`${idPrefix}-padding`} label="Container padding" value={preloader.padding} min={16} max={72} onChange={(padding) => update({ padding })} />
            </div>
          </section>
        </div>
      </div>

      <div className="self-start xl:sticky xl:top-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            Responsive preview
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview animation
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">
          <PublicPreloader settings={preloader} preview />
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[760px] overflow-hidden border-0 bg-transparent p-0">
          <DialogTitle className="sr-only">Preloader animation preview</DialogTitle>
          <PublicPreloader
            settings={preloader}
            preview
            className="min-h-[72dvh]"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
