"use client";
import { useRef, useState } from "react";
import {
  specialtyProductWriteSchema,
  type SpecialtyProductDraft,
  type SpecialtyProductMetadata,
  type SpecialtyProductWrite,
} from "./specialty-product-contract";

export function buildSpecialtyProductWrite(
  metadata: SpecialtyProductMetadata,
  quantity: number,
  initial?: SpecialtyProductDraft,
): SpecialtyProductWrite {
  if (initial?.hasClaims && quantity !== initial.remainingQuantity)
    throw new Error("Quantity cannot change after a successful claim.");
  return specialtyProductWriteSchema.parse(
    initial
      ? {
          ...metadata,
          mode: "update",
          productId: initial.productId,
          expectedRevision: initial.revision,
          ...(quantity !== initial.remainingQuantity ? { quantity } : {}),
        }
      : { ...metadata, mode: "create", quantity },
  );
}
function localDate(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function SpecialtyProductForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: SpecialtyProductDraft;
  onSubmit(input: SpecialtyProductWrite): Promise<void>;
  onCancel(): void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [quantity, setQuantity] = useState(initial?.remainingQuantity ?? 1);
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [goLive, setGoLive] = useState(() =>
    localDate(initial?.goLiveAt ?? new Date().toISOString()),
  );
  const [images, setImages] = useState(initial?.images ?? []);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [message, setError] = useState("");
  const pending = useRef(false);
  const fieldClass =
    "mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-3 text-white";
  const labelClass = "block text-sm text-zinc-300";
  async function upload(files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError("");
    try {
      const urls: string[] = [];
      if (images.length + files.length > 20) throw new Error("Use up to 20 images.");
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        if (initial) body.append("productId", initial.productId);
        const response = await fetch("/api/admin/uploads/product-image", {
          method: "POST",
          body,
        });
        const result = await response.json().catch(() => null);
        if (
          !response.ok ||
          !Array.isArray(result?.uploads) ||
          !result.uploads.every((item: { url?: unknown }) => typeof item.url === "string")
        )
          throw new Error("An image could not be uploaded. Try again.");
        urls.push(...result.uploads.map((item: { url: string }) => item.url));
      }
      setImages((current) => [
        ...current,
        ...urls.map((url, index) => ({
          url,
          sortOrder: current.length + index,
          isPrimary: current.length + index === 0,
        })),
      ]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      data-admin-form
      className="space-y-5 rounded border border-zinc-800 bg-zinc-950 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          if (pending.current || uploading) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await onSubmit(
              buildSpecialtyProductWrite(
                {
                  name,
                  description: description || null,
                  instructions: instructions || null,
                  goLiveAt: new Date(goLive).toISOString(),
                  images,
                },
                quantity,
                initial,
              ),
            );
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "The product could not be saved.",
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        })();
      }}
    >
      <h2 className="text-xl font-semibold text-white">Specialty giveaway</h2>
      <p className="text-sm text-zinc-400">
        Free to claim. The reseller arranges the prize with the winner on Instagram.
      </p>
      <label className={labelClass}>
        Title
        <input
          required
          maxLength={300}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Description
        <textarea
          maxLength={10000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Quantity
        <input
          type="number"
          required
          min={0}
          max={2147483647}
          step={1}
          disabled={initial?.hasClaims}
          value={quantity}
          onChange={(e) => setQuantity(e.target.valueAsNumber)}
          className={fieldClass}
        />
      </label>
      {initial?.hasClaims && (
        <p className="text-sm text-zinc-400">
          Quantity is locked after the first successful claim.
        </p>
      )}
      <label className={labelClass}>
        Go live
        <input
          required
          type="datetime-local"
          value={goLive}
          onChange={(e) => setGoLive(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Winning instructions
        <textarea
          maxLength={4000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={fieldClass}
        />
      </label>
      <p className="text-sm text-zinc-400">
        Leave blank to confirm the win and explain that the reseller will contact the
        winner on Instagram.
      </p>
      <label className={labelClass}>
        Images
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploading || busy}
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = "";
          }}
          className={fieldClass}
        />
      </label>
      {uploading && <p role="status">Uploading images…</p>}
      <ul className="space-y-2">
        {images.map((image, index) => (
          <li key={image.url + index} className="flex gap-3 text-sm text-zinc-300">
            <a href={image.url} target="_blank" rel="noreferrer">
              Image {index + 1}
              {image.isPrimary ? " (primary)" : ""}
            </a>
            <button
              type="button"
              onClick={() =>
                setImages((current) =>
                  current
                    .filter((_, i) => i !== index)
                    .map((item, i) => ({ ...item, sortOrder: i, isPrimary: i === 0 })),
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="text-red-400">
          {message}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || uploading}
          className="admin-button-primary"
        >
          {busy ? "Saving…" : "Save specialty product"}
        </button>
        <button type="button" onClick={onCancel} className="admin-button-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
