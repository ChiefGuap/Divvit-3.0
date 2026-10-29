/* Sleeve artwork for a campaign: generated from the startup's saved profile
   (name, one-liner, logo, website → QR code) on a chosen stock, or an upload.
   The QR code goes through divvit.app/s/<scan code>, which counts scans for the
   campaign report and forwards to the website (app/s/[code]/route.ts). */

import QRCode from "qrcode";
import { drawSleeve, drawUploadedSleeve, loadSleeveFonts, SLEEVE_FONTS, SLEEVE_H, SLEEVE_STOCKS, SLEEVE_W } from "@/lib/cup/textures";
import { proxied } from "./images";

export type Brand = { name: string; description: string | null; website: string | null; logo_url: string | null };
export type SleeveChoice = { stock: string; upload: string | null };

// each stock gets a typeface that suits it
const FONT_FOR: Record<string, number> = { kraft: 2, midnight: 1, cream: 0, sage: 2, navy: 4, lilac: 5 };

export const stockOf = (id: string) => SLEEVE_STOCKS.find((s) => s.id === id) ?? SLEEVE_STOCKS[0];
export const sleeveBase = (c: SleeveChoice) => (c.upload ? "#e9e2d6" : stockOf(c.stock).base);

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

/** The code in a sleeve's QR link; made here because the sleeve is drawn before the campaign exists. */
export function newScanCode() {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 characters, none that read alike (0/o, 1/l)
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => abc[x % abc.length]).join("");
}

const tagline = (d: string | null) => {
  const first = (d || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 57).trim()}…` : first.replace(/[.]$/, "");
};

/** scanUrl: where the QR code points (the tracked link); without it, straight to the website */
export async function renderSleeve(brand: Brand, choice: SleeveChoice, scanUrl?: string): Promise<HTMLCanvasElement> {
  if (choice.upload) return drawUploadedSleeve(await loadImage(choice.upload));
  const stock = stockOf(choice.stock);
  const font = SLEEVE_FONTS[FONT_FOR[stock.id] ?? 2];
  await loadSleeveFonts([font]);
  const site = brand.website ? (/^https?:\/\//.test(brand.website) ? brand.website : `https://${brand.website}`) : null;
  const [logo, qr] = await Promise.all([
    brand.logo_url ? loadImage(proxied(brand.logo_url)!).catch(() => null) : Promise.resolve(null),
    site ? (async () => {
      const c = document.createElement("canvas");
      const u = new URL(site);
      u.searchParams.set("utm_source", "divvit");
      await QRCode.toCanvas(c, scanUrl ?? u.toString(), { margin: 0, width: 300, errorCorrectionLevel: "M" });
      return c;
    })().catch(() => null) : Promise.resolve(null),
  ]);
  return drawSleeve({ base: stock.base, ink: stock.ink, name: brand.name, tagline: tagline(brand.description), font, logo, qr, qrLabel: qr ? "Scan me" : undefined });
}

/** A guide for designers: the wrap, the front, the safe area. */
export function downloadTemplate() {
  const c = document.createElement("canvas");
  c.width = SLEEVE_W; c.height = SLEEVE_H;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f6f1ff"; x.fillRect(0, 0, SLEEVE_W, SLEEVE_H);
  x.fillStyle = "rgba(140,82,255,.10)"; x.fillRect(SLEEVE_W * 0.3, 0, SLEEVE_W * 0.4, SLEEVE_H);
  x.strokeStyle = "rgba(140,82,255,.6)"; x.setLineDash([12, 10]); x.lineWidth = 3;
  x.strokeRect(24, 30, SLEEVE_W - 48, SLEEVE_H - 60);
  x.setLineDash([]); x.fillStyle = "#3a2089"; x.textAlign = "center"; x.font = "700 30px Outfit, Inter, sans-serif";
  x.fillText("FRONT — faces the customer", SLEEVE_W / 2, SLEEVE_H / 2 - 10);
  x.font = "500 22px Inter, sans-serif";
  x.fillText("2048 × 432 px · keep text inside the dashed line", SLEEVE_W / 2, SLEEVE_H / 2 + 28);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = "divvit-sleeve-template-2048x432.png";
  a.click();
}
