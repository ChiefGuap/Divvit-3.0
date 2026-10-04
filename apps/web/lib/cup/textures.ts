/* Procedural textures for the 3D paper cup, and the sleeve artwork generator.

   Everything is drawn on <canvas> at runtime — no image assets — so the same
   code renders the landing-page sleeves and the marketplace's in-house sleeve
   generator. Canvas text uses real font-family names, so the fonts have to be
   loaded through a <link> (next/font renames families and canvas can't see them). */

import * as THREE from "three";

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function luminance(hex: string) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const canvas2d = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
};

export function toTexture(c: HTMLCanvasElement, aniso: number, wrap = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ---------------------------------------------------------------- cup surfaces */

export function paperTextures(aniso: number) {
  const S = 1024;
  const [c, x] = canvas2d(S, S);
  x.fillStyle = "#f2eee6";
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random() < 0.5 ? 255 : 120;
    x.fillStyle = `rgba(${v},${v},${v - 10},${rand(0.02, 0.06)})`;
    x.fillRect(rand(0, S), rand(0, S), rand(1, 3), rand(1, 3));
  }
  // glued side-seam
  const sx = S * 0.5;
  const sg = x.createLinearGradient(sx - 10, 0, sx + 14, 0);
  sg.addColorStop(0, "rgba(0,0,0,0)");
  sg.addColorStop(0.42, "rgba(70,55,40,.12)");
  sg.addColorStop(0.5, "rgba(255,255,255,.25)");
  sg.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = sg;
  x.fillRect(sx - 10, 0, 24, S);
  const map = toTexture(c, aniso);

  const [b, bx] = canvas2d(512, 512);
  bx.fillStyle = "#808080";
  bx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = Math.floor(rand(100, 160));
    bx.fillStyle = `rgba(${v},${v},${v},.35)`;
    bx.fillRect(rand(0, 512), rand(0, 512), 1.5, 1.5);
  }
  const bump = new THREE.CanvasTexture(b);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(4, 2);
  return { map, bump };
}

/** Vertical corrugated flutes + fibre noise for the cardboard sleeve. */
export function sleeveBumpTexture() {
  const W = 2048, H = 256;
  const [c, x] = canvas2d(W, H);
  for (let i = 0; i < W; i++) {
    const v = 128 + 34 * Math.sin((i / W) * Math.PI * 2 * 220);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(i, 0, 1, H);
  }
  for (let i = 0; i < 20000; i++) {
    const v = Math.floor(rand(80, 180));
    x.fillStyle = `rgba(${v},${v},${v},.25)`;
    x.fillRect(rand(0, W), rand(0, H), rand(1, 5), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function latteTexture(aniso: number) {
  const S = 1024, m = S / 2;
  const [c, x] = canvas2d(S, S);
  const g = x.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, "#7a4a2b");
  g.addColorStop(0.55, "#5a341d");
  g.addColorStop(0.86, "#8a5a36");
  g.addColorStop(0.95, "#4a2a17");
  g.addColorStop(1, "#2e190d");
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) {
    x.fillStyle = `rgba(255,225,190,${rand(0.03, 0.12)})`;
    x.beginPath();
    x.arc(rand(0, S), rand(0, S), rand(0.5, 2.2), 0, Math.PI * 2);
    x.fill();
  }
  const heart = (cx: number, cy: number, s: number) => {
    x.beginPath();
    x.moveTo(cx, cy + s * 0.55);
    x.bezierCurveTo(cx - s * 1.05, cy - s * 0.05, cx - s * 0.6, cy - s * 0.95, cx, cy - s * 0.42);
    x.bezierCurveTo(cx + s * 0.6, cy - s * 0.95, cx + s * 1.05, cy - s * 0.05, cx, cy + s * 0.55);
    x.closePath();
  };
  // layered rosetta-heart
  const layers: [number, string][] = [
    [330, "#f1e3cc"], [262, "rgba(120,75,40,.55)"], [232, "#efe0c6"], [172, "rgba(120,75,40,.5)"],
    [146, "#f3e6d1"], [92, "rgba(120,75,40,.45)"], [70, "#f5ead8"],
  ];
  for (const [s, col] of layers) {
    x.save();
    x.filter = `blur(${s > 200 ? 9 : 6}px)`;
    x.fillStyle = col;
    heart(m, m + 30 - (330 - s) * 0.18, s);
    x.fill();
    x.restore();
  }
  x.save();
  x.filter = "blur(4px)";
  x.strokeStyle = "rgba(110,68,36,.55)";
  x.lineWidth = 9;
  x.beginPath();
  x.moveTo(m, m + 230);
  x.lineTo(m, m - 150);
  x.stroke();
  x.restore();
  return toTexture(c, aniso);
}

export function steamTexture() {
  const [c, x] = canvas2d(256, 256);
  for (let i = 0; i < 18; i++) {
    const px = 128 + rand(-40, 40), py = 128 + rand(-40, 40), r = rand(40, 90);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(c);
}

export function contactShadowTexture() {
  const [c, x] = canvas2d(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(43,29,92,.7)");
  g.addColorStop(0.35, "rgba(43,29,92,.32)");
  g.addColorStop(1, "rgba(43,29,92,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/* ---------------------------------------------------------------- sleeve artwork */

/** The sleeve wraps the full circumference: x = 0..W is 360°, the middle (W/2)
    faces the camera at rest, and the left/right edges meet at the back. */
export const SLEEVE_W = 2048;
export const SLEEVE_H = 432;

export type SleeveFont = { family: string; weight: string; style: string };

export type SleeveArt = {
  base: string;          // sleeve stock colour (kraft, black, cream...)
  ink: string;           // print colour
  name: string;
  tagline: string;
  font: SleeveFont;
  backText?: string;     // small line printed on the back of the cup
  logo?: CanvasImageSource | null;  // replaces the initial in the round mark
  qr?: CanvasImageSource | null;    // printed to the right of the wordmark
  qrLabel?: string;
};

/** Cardboard stock: base colour, mottling, fibres. */
function drawStock(x: CanvasRenderingContext2D, base: string) {
  const W = SLEEVE_W, H = SLEEVE_H;
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  const dark = luminance(base) < 0.25;
  for (let i = 0; i < 70; i++) {
    const r = rand(60, 260), px = rand(0, W), py = rand(0, H);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const tone = Math.random() < 0.5 ? "0,0,0" : "255,255,255";
    g.addColorStop(0, `rgba(${tone},${rand(0.025, 0.06)})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 7000; i++) {
    const tone = Math.random() < 0.5 ? (dark ? "255,255,255" : "60,35,15") : dark ? "0,0,0" : "255,240,220";
    x.strokeStyle = `rgba(${tone},${rand(0.03, 0.1)})`;
    x.lineWidth = rand(0.5, 1.4);
    const px = rand(0, W), py = rand(0, H), l = rand(3, 14), a = rand(-0.5, 0.5);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
}

function edgeDarken(x: CanvasRenderingContext2D) {
  for (const [y0, y1] of [[0, 12], [SLEEVE_H, SLEEVE_H - 12]]) {
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "rgba(0,0,0,.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, Math.min(y0, y1), SLEEVE_W, 12);
  }
}

export function drawSleeve(art: SleeveArt): HTMLCanvasElement {
  const W = SLEEVE_W, H = SLEEVE_H, cx = W / 2, cy = H / 2;
  const [c, x] = canvas2d(W, H);
  drawStock(x, art.base);

  // ---- print layer (drawn separately so specks can be knocked out of it)
  const [p, q] = canvas2d(W, H);
  q.fillStyle = q.strokeStyle = art.ink;
  q.textBaseline = "middle";
  const fontStr = (px: number) => `${art.font.style} ${art.font.weight} ${px}px "${art.font.family}"`;
  const name = art.name.trim() || "Your brand";

  let size = 132;
  q.font = fontStr(size);
  const maxName = art.qr ? 560 : 680;
  while (q.measureText(name).width > maxName && size > 54) {
    size -= 4;
    q.font = fontStr(size);
  }
  const nameW = q.measureText(name).width;
  const markR = 48, gap = 34, qrS = art.qr ? 150 : 0, qrGap = art.qr ? 56 : 0;
  const total = markR * 2 + gap + nameW + qrGap + qrS;
  const left = cx - total / 2;
  const my = cy - 30;

  // round mark: the logo if there is one, otherwise the initial knocked out of an ink disc
  if (art.logo) {
    q.save();
    q.beginPath();
    q.arc(left + markR, my, markR, 0, Math.PI * 2);
    q.fillStyle = "#ffffff";
    q.fill();
    q.clip();
    q.drawImage(art.logo, left, my - markR, markR * 2, markR * 2);
    q.restore();
    q.lineWidth = 4;
    q.beginPath();
    q.arc(left + markR, my, markR, 0, Math.PI * 2);
    q.stroke();
  } else {
    q.beginPath();
    q.arc(left + markR, my, markR, 0, Math.PI * 2);
    q.fill();
    q.save();
    q.globalCompositeOperation = "destination-out";
    q.font = fontStr(58);
    q.textAlign = "center";
    q.fillText(name[0], left + markR, my + 3);
    q.restore();
  }
  q.textAlign = "left";
  q.font = fontStr(size);
  q.fillText(name, left + markR * 2 + gap, my + 4);

  // tagline with rules either side
  const tag = (art.tagline || "").toUpperCase();
  if (tag) {
    let ts = 22, ls = 7;
    const setTag = () => {
      q.font = `600 ${ts}px Inter`;
      q.letterSpacing = `${ls}px`;
    };
    q.textAlign = "center";
    setTag();
    while (q.measureText(tag).width > 560 && ts > 14) {
      ts -= 1;
      ls = Math.max(3, ls - 0.4);
      setTag();
    }
    const tx = art.qr ? cx - (qrS + qrGap) / 2 : cx;
    q.fillText(tag, tx, cy + 66);
    const tw = q.measureText(tag).width;
    q.fillRect(tx - tw / 2 - 120, cy + 64, 90, 2.5);
    q.fillRect(tx + tw / 2 + 30, cy + 64, 90, 2.5);
    q.letterSpacing = "0px";
  }

  // die-cut stitch borders
  q.setLineDash([14, 10]);
  q.lineWidth = 3;
  q.beginPath();
  q.moveTo(0, 22);
  q.lineTo(W, 22);
  q.moveTo(0, H - 22);
  q.lineTo(W, H - 22);
  q.stroke();
  q.setLineDash([]);

  // back line — straddles the texture seam so it sits on the back of the cup
  q.font = "700 20px Inter";
  q.letterSpacing = "6px";
  q.textAlign = "center";
  const back = `★  ${(art.backText || "Careful, it's hot").toUpperCase()}  ★`;
  q.fillText(back, 0, cy);
  q.fillText(back, W, cy);
  q.letterSpacing = "0px";

  // imperfect print: knock out tiny specks
  q.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 16000; i++) {
    q.fillStyle = `rgba(0,0,0,${rand(0.2, 0.7)})`;
    q.fillRect(rand(0, W), rand(0, H), rand(0.8, 2.4), rand(0.8, 2.4));
  }
  x.globalAlpha = 0.93;
  x.drawImage(p, 0, 0);
  x.globalAlpha = 1;

  // QR code goes on a white patch, unspeckled, so it actually scans
  if (art.qr) {
    const qx = left + markR * 2 + gap + nameW + qrGap, qy = my - qrS / 2 + 18;
    x.fillStyle = "#ffffff";
    x.fillRect(qx - 10, qy - 10, qrS + 20, qrS + 20);
    x.imageSmoothingEnabled = false;
    x.drawImage(art.qr, qx, qy, qrS, qrS);
    x.imageSmoothingEnabled = true;
    if (art.qrLabel) {
      x.fillStyle = art.ink;
      x.font = "700 17px Inter";
      x.textAlign = "center";
      x.textBaseline = "top";
      x.fillText(art.qrLabel.toUpperCase(), qx + qrS / 2, qy + qrS + 18);
    }
  }

  edgeDarken(x);
  return c;
}

/** An uploaded design, cover-fitted onto the sleeve with the same stock edges. */
export function drawUploadedSleeve(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): HTMLCanvasElement {
  const W = SLEEVE_W, H = SLEEVE_H;
  const [c, x] = canvas2d(W, H);
  const iw = "naturalWidth" in img ? img.naturalWidth : img.width;
  const ih = "naturalHeight" in img ? img.naturalHeight : img.height;
  const s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  x.fillStyle = "#e9e2d6";
  x.fillRect(0, 0, W, H);
  x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  edgeDarken(x);
  return c;
}

/* ---------------------------------------------------------------- generator presets */

export const SLEEVE_STOCKS = [
  { id: "kraft", label: "Kraft", base: "#b9895b", ink: "#2a170c" },
  { id: "midnight", label: "Midnight", base: "#1c1c1e", ink: "#c6ff3d" },
  { id: "cream", label: "Cream", base: "#efe5d3", ink: "#c93c25" },
  { id: "sage", label: "Sage", base: "#a7b597", ink: "#183324" },
  { id: "navy", label: "Navy", base: "#1e2d4b", ink: "#e8eef8" },
  { id: "lilac", label: "Divvit lilac", base: "#e6d9ff", ink: "#3a2089" },
] as const;

export const SLEEVE_FONTS: SleeveFont[] = [
  { family: "Instrument Serif", weight: "400", style: "italic" },
  { family: "Archivo Black", weight: "400", style: "normal" },
  { family: "Bricolage Grotesque", weight: "800", style: "normal" },
  { family: "JetBrains Mono", weight: "800", style: "normal" },
  { family: "Inter", weight: "800", style: "normal" },
  { family: "Outfit", weight: "800", style: "normal" },
];

export async function loadSleeveFonts(fonts: SleeveFont[] = SLEEVE_FONTS) {
  const loads = fonts
    .map((f) => document.fonts.load(`${f.style} ${f.weight} 64px "${f.family}"`))
    .concat(document.fonts.load("600 22px Inter"), document.fonts.load("700 20px Inter"));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]);
}
