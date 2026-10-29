"use client";

/* The café's own photo, shown on its card in the marketplace. The owner picks one
   from their device; it's shrunk here (longest side 1600px, JPEG) and stored in
   their folder of mp-cafe-photos, then saved on the listing.
   compact: just the thumbnail, click to change it (the inbox header). */

import React from "react";
import { useMp } from "./session";
import { cafePhotoUrl } from "@/lib/marketplace/images";
import type { Cafe } from "@/lib/marketplace/types";

const BUCKET = "mp-cafe-photos";

async function shrink(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("could not read the photo"))), "image/jpeg", 0.85));
}

export function CafePhoto({ cafe, onSaved, compact = false }: { cafe: Cafe; onSaved: () => void; compact?: boolean }) {
  const { supabase, user } = useMp();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const src = cafePhotoUrl(cafe.photo);

  async function upload(file: File) {
    if (!user) return;
    setBusy(true); setError(null);
    try {
      const path = `${user.id}/${cafe.id}-${Date.now()}.jpg`;
      const up = await supabase.storage.from(BUCKET).upload(path, await shrink(file), { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { error: save } = await supabase.from("mp_cafes").update({ photo: path }).eq("id", cafe.id);
      if (save) throw save;
      // the photo it replaces isn't used anywhere else
      if (cafe.photo && !/^https:/.test(cafe.photo)) supabase.storage.from(BUCKET).remove([cafe.photo]).catch(() => {});
      onSaved();
    } catch {
      setError("That photo didn't upload. Try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
  );

  if (compact) {
    return (
      <button type="button" className="cafe-thumb" disabled={busy} onClick={() => input.current?.click()}
        title={error ?? "Change your café photo"} aria-label="Change your café photo">
        {src && <img src={src} alt="" />}
        <span>{busy ? "Uploading" : "Change"}</span>
        {picker}
      </button>
    );
  }
  return (
    <div className="cafe-photo">
      <div className={`ph${src ? " has" : ""}`}>{src ? <img src={src} alt={`${cafe.name}`} /> : <span>No photo yet</span>}</div>
      <div className="t">
        <small>Startups see it at the top of your café&apos;s card. A bright shot of your storefront or counter works best.</small>
        <button type="button" className="mp-btn primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : src ? "Change photo" : "Upload a photo"}
        </button>
        {error && <p className="mp-error">{error}</p>}
      </div>
      {picker}
    </div>
  );
}
