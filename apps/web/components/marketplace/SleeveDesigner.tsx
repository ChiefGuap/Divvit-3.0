"use client";

/* Sleeve artwork: build one with the in-house generator, or upload your own.
   Produces a 2048×432 canvas that wraps the whole cup (middle faces forward). */

import React from "react";
import QRCode from "qrcode";
import {
  drawSleeve, drawUploadedSleeve, loadSleeveFonts, SLEEVE_FONTS, SLEEVE_H, SLEEVE_STOCKS, SLEEVE_W,
} from "@/lib/cup/textures";

export type DesignState = {
  mode: "generator" | "upload";
  stock: string;
  base: string;
  ink: string;
  font: number;
  headline: string;
  tagline: string;
  logo: string | null;      // data: URL or a URL served through /api/image
  qr: boolean;
  qrUrl: string;
  upload: string | null;    // data: URL of an uploaded design
};

export const defaultDesign = (name = "", tagline = "", website = "", logo: string | null = null): DesignState => ({
  mode: "generator", stock: "kraft", base: SLEEVE_STOCKS[0].base, ink: SLEEVE_STOCKS[0].ink, font: 2,
  headline: name, tagline, logo, qr: Boolean(website), qrUrl: website, upload: null,
});

export { proxied } from "@/lib/marketplace/images";

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

const readFile = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(f);
});

/** Render a design state to the sleeve canvas. */
export async function renderDesign(d: DesignState): Promise<HTMLCanvasElement> {
  if (d.mode === "upload" && d.upload) return drawUploadedSleeve(await loadImage(d.upload));
  await loadSleeveFonts([SLEEVE_FONTS[d.font] ?? SLEEVE_FONTS[0]]);
  const [logo, qr] = await Promise.all([
    d.logo ? loadImage(d.logo).catch(() => null) : Promise.resolve(null),
    d.qr && d.qrUrl ? (async () => {
      const c = document.createElement("canvas");
      await QRCode.toCanvas(c, d.qrUrl, { margin: 0, width: 300, errorCorrectionLevel: "M" });
      return c;
    })().catch(() => null) : Promise.resolve(null),
  ]);
  return drawSleeve({
    base: d.base, ink: d.ink, name: d.headline, tagline: d.tagline, font: SLEEVE_FONTS[d.font] ?? SLEEVE_FONTS[0],
    logo, qr, qrLabel: qr ? "Scan me" : undefined,
  });
}

/** A printable guide for designers: the wrap, the front, the safe area. */
function downloadTemplate() {
  const c = document.createElement("canvas");
  c.width = SLEEVE_W; c.height = SLEEVE_H;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f6f1ff"; x.fillRect(0, 0, SLEEVE_W, SLEEVE_H);
  x.fillStyle = "rgba(140,82,255,.10)"; x.fillRect(SLEEVE_W * 0.3, 0, SLEEVE_W * 0.4, SLEEVE_H);
  x.strokeStyle = "rgba(140,82,255,.6)"; x.setLineDash([12, 10]); x.lineWidth = 3;
  x.strokeRect(24, 30, SLEEVE_W - 48, SLEEVE_H - 60);
  x.beginPath(); x.moveTo(SLEEVE_W / 2, 0); x.lineTo(SLEEVE_W / 2, SLEEVE_H); x.stroke();
  x.setLineDash([]); x.fillStyle = "#3a2089"; x.textAlign = "center"; x.font = "700 30px Outfit, Inter, sans-serif";
  x.fillText("FRONT — faces the customer", SLEEVE_W / 2, SLEEVE_H / 2 - 10);
  x.font = "500 22px Inter, sans-serif";
  x.fillText("2048 × 432 px · keep text inside the dashed line", SLEEVE_W / 2, SLEEVE_H / 2 + 28);
  x.fillText("← back of the cup", 170, SLEEVE_H / 2);
  x.fillText("back of the cup →", SLEEVE_W - 170, SLEEVE_H / 2);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = "divvit-sleeve-template-2048x432.png";
  a.click();
}

export function SleeveDesigner({ value, onChange }: { value: DesignState; onChange: (d: DesignState) => void }) {
  const set = (patch: Partial<DesignState>) => onChange({ ...value, ...patch });
  const [over, setOver] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const uploadInput = React.useRef<HTMLInputElement>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);

  const takeFile = async (f: File | undefined, field: "upload" | "logo") => {
    setErr(null);
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setErr("Use a PNG, JPG or WebP image."); return; }
    if (f.size > 8 * 1024 * 1024) { setErr("That file is over 8MB — try a smaller export."); return; }
    const url = await readFile(f);
    set(field === "upload" ? { upload: url, mode: "upload" } : { logo: url });
  };

  return (
    <div className="mp-card pad">
      <div className="mp-seg">
        <button className={value.mode === "generator" ? "on" : ""} onClick={() => set({ mode: "generator" })}>Use our generator</button>
        <button className={value.mode === "upload" ? "on" : ""} onClick={() => set({ mode: "upload" })}>Upload your design</button>
      </div>

      {value.mode === "generator" ? (
        <>
          <div className="mp-field">
            <span>Sleeve stock</span>
            <div className="mp-swatches">
              {SLEEVE_STOCKS.map((s) => (
                <button key={s.id} className={`mp-swatch${value.stock === s.id ? " on" : ""}`} onClick={() => set({ stock: s.id, base: s.base, ink: s.ink })}>
                  <i style={{ background: s.base, color: s.ink }}>Aa</i>{s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mp-colors">
            <label className="mp-color"><input type="color" value={value.base} onChange={(e) => set({ base: e.target.value, stock: "custom" })} />Sleeve colour</label>
            <label className="mp-color"><input type="color" value={value.ink} onChange={(e) => set({ ink: e.target.value })} />Ink colour</label>
          </div>
          <div className="mp-field">
            <span>Typeface</span>
            <div className="mp-chips">
              {SLEEVE_FONTS.map((f, i) => (
                <button key={f.family} className={`mp-chip${value.font === i ? " on" : ""}`} onClick={() => set({ font: i })}
                  style={{ fontFamily: `"${f.family}"`, fontStyle: f.style, fontWeight: Number(f.weight) }}>{f.family}</button>
              ))}
            </div>
          </div>
          <div className="mp-grid2">
            <label className="mp-field"><span>Headline</span><input className="mp-input" value={value.headline} maxLength={28} onChange={(e) => set({ headline: e.target.value })} placeholder="Your brand" /></label>
            <label className="mp-field"><span>Tagline</span><input className="mp-input" value={value.tagline} maxLength={60} onChange={(e) => set({ tagline: e.target.value })} placeholder="One line about you" /></label>
          </div>
          <div className="mp-field">
            <span>Logo</span>
            <div className="mp-logo-row">
              {value.logo ? <img src={value.logo} alt="" style={{ objectFit: "contain", background: "#fff" }} /> : <span className="mp-logo-ph">{(value.headline || "?")[0]}</span>}
              <button className="mp-filebtn" onClick={() => logoInput.current?.click()}>{value.logo ? "Replace" : "Upload logo"}</button>
              {value.logo && <button className="mp-filebtn" onClick={() => set({ logo: null })}>Use initial instead</button>}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => takeFile(e.target.files?.[0], "logo")} />
            </div>
          </div>
          <label className="mp-toggle">
            <input type="checkbox" checked={value.qr} onChange={(e) => set({ qr: e.target.checked })} />
            <span className="sw" />
            <span><b>Print a QR code</b><small>Every scan is an engagement you can count.</small></span>
          </label>
          {value.qr && (
            <label className="mp-field"><span>QR code links to</span>
              <input className="mp-input" value={value.qrUrl} onChange={(e) => set({ qrUrl: e.target.value })} placeholder="https://yourstartup.com/coffee" />
              <small>Tip: use a campaign link (e.g. ?utm_source=divvit) so you can tell these visits apart.</small>
            </label>
          )}
        </>
      ) : (
        <>
          <div
            className={`mp-drop${over ? " over" : ""}`}
            onClick={() => uploadInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0], "upload"); }}
          >
            {value.upload ? (
              <><img src={value.upload} alt="Your design" style={{ width: "100%", borderRadius: 10 }} /><div style={{ marginTop: 10 }}><b>Replace design</b></div></>
            ) : (
              <><b>Drop your sleeve design</b> or click to choose a file<div className="mp-small mp-muted" style={{ marginTop: 6 }}>PNG, JPG or WebP · 2048 × 432 px works best</div></>
            )}
          </div>
          <input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => takeFile(e.target.files?.[0], "upload")} />
          <p className="mp-small mp-muted" style={{ margin: 0 }}>
            The artwork wraps all the way around the cup: the middle faces the customer and the left and right edges meet at the back.{" "}
            <button className="mp-filebtn" onClick={downloadTemplate}>Download template</button>
          </p>
        </>
      )}
      {err && <div className="mp-error">{err}</div>}
    </div>
  );
}
