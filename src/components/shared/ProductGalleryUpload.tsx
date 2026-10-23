import { useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { uploadFileToStorage } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function ProductGalleryUpload({
  id,
  label = "Gallery images",
  maxItems = 8,
  onChange,
  value,
}: {
  id: string;
  label?: string;
  maxItems?: number;
  onChange: (value: string[]) => void;
  value: string[];
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const images = Array.from(new Set(value.filter(Boolean))).slice(0, maxItems);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const remaining = maxItems - images.length;
    if (remaining <= 0) {
      setError(`You can add up to ${maxItems} gallery images.`);
      return;
    }
    const selectedFiles = files.slice(0, remaining);
    const invalidFile = selectedFiles.find(
      (file) =>
        !ACCEPTED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES,
    );
    if (invalidFile) {
      setError("Choose PNG, JPEG, or WebP images smaller than 5 MB each.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const stored = await Promise.all(
        selectedFiles.map((file) =>
          uploadFileToStorage(file, {
            purpose: "product_image",
            visibility: "public",
          }),
        ),
      );
      const urls = stored
        .map((item) => item.url)
        .filter((url): url is string => Boolean(url));
      if (urls.length !== selectedFiles.length) {
        throw new Error("One or more gallery image URLs were unavailable.");
      }
      onChange([...images, ...urls].slice(0, maxItems));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The gallery images could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };

  const remove = (index: number) => {
    onChange(images.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-[10px] text-muted-foreground">
          {images.length}/{maxItems} images
        </span>
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="group relative aspect-square min-w-0 overflow-hidden rounded-md border border-border bg-background"
            >
              <img
                src={image}
                alt={`Gallery image ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7 opacity-100 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                onClick={() => remove(index)}
                aria-label={`Remove gallery image ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {images.length < maxItems && (
            <label
              htmlFor={id}
              className="flex aspect-square min-w-0 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border px-2 text-center transition-colors hover:bg-accent/50"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="mt-2 text-[10px] font-medium">
                {uploading ? "Uploading..." : "Add images"}
              </span>
              <span className="mt-1 text-[9px] leading-4 text-muted-foreground">
                PNG, JPG, or WebP
              </span>
            </label>
          )}
        </div>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={upload}
          className="sr-only"
          disabled={uploading}
        />
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Add up to {maxItems} images. The main product image remains the cover
          image; these appear in the public product gallery.
        </p>
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
