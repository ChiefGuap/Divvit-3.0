/* Two small architectural models for the homepage — a startup HQ and a corner
   café — lit like an archviz cut-out: soft daylight, a contact shadow on a
   transparent ground, and warm interiors you can see into through the glass
   (each window opens onto a real shallow room, so it parallaxes as it turns).
   Rendered on demand; the model turns a few degrees as its section scrolls by.

   Units: 1 = 1 m. Front faces +z. */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type BuildingKind = "startup" | "cafe";

/* ---------------------------------------------------------------- textures */

function seeded(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
function canvasTexture(w: number, h: number, draw: Draw, { color = true, repeat = true, seed = 7 } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, w, h, seeded(seed));
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const grain = (g: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, alpha: number) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
};

/** Dark vertical board cladding; one tile = 1 m with 7 boards. */
const boards = (base: [number, number, number], bump = false) => canvasTexture(512, 512, (g, w, h, r) => {
  const n = 7, bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = bump ? 150 : 0, j = (r() - 0.5) * 10;
    g.fillStyle = bump ? `rgb(${v},${v},${v})` : `rgb(${base[0] + j},${base[1] + j},${base[2] + j})`;
    g.fillRect(i * bw, 0, bw, h);
    if (!bump) for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(255,255,255,${0.025 * r()})`;
      g.fillRect(i * bw + r() * bw, 0, 1, h);
    }
    g.fillStyle = bump ? "#000" : "rgba(0,0,0,.55)";
    g.fillRect(i * bw, 0, bump ? 4 : 3, h);
  }
  if (!bump) grain(g, w, h, r, 3000, 0.05);
}, { color: !bump, seed: bump ? 3 : 11 });

const concrete = () => canvasTexture(256, 256, (g, w, h, r) => {
  g.fillStyle = "#cfcac2"; g.fillRect(0, 0, w, h);
  grain(g, w, h, r, 5000, 0.06);
});

const oak = () => canvasTexture(256, 256, (g, w, h, r) => {
  g.fillStyle = "#b8895a"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(${r() > 0.5 ? "90,55,25" : "235,200,150"},${0.12 * r() + 0.04})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * w;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 20, h * 0.33, x + (r() - 0.5) * 20, h * 0.66, x + (r() - 0.5) * 10, h);
    g.stroke();
  }
}, { seed: 21 });

/** Red brick, one tile ≈ 1 m: 15 courses of 4 bricks. */
const brick = (bump = false) => canvasTexture(512, 512, (g, w, h, r) => {
  const rows = 15, cols = 4, bh = h / rows, bw = w / cols, m = 4;
  g.fillStyle = bump ? "#000" : "#d7cec2"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? bw / 2 : 0;
    for (let x = -1; x <= cols; x++) {
      if (bump) g.fillStyle = "#c8c8c8";
      else {
        const t = r(), k = 0.85 + r() * 0.25;
        const [rr, gg, bb] = t < 0.15 ? [128, 62, 44] : t < 0.3 ? [168, 92, 64] : [148, 72, 50];
        g.fillStyle = `rgb(${rr * k | 0},${gg * k | 0},${bb * k | 0})`;
      }
      g.fillRect(x * bw + off + m / 2, y * bh + m / 2, bw - m, bh - m);
    }
  }
  if (!bump) grain(g, w, h, r, 9000, 0.07);
}, { color: !bump, seed: bump ? 5 : 31 });

/** Awning fabric: Divvit-purple and cream stripes. */
const stripes = () => canvasTexture(256, 64, (g, w, h) => {
  const n = 8;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? "#f3ece1" : "#6f45d8"; g.fillRect((i * w) / n, 0, w / n, h); }
  g.fillStyle = "rgba(0,0,0,.06)";
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
});

/* interiors: what you see through the glass, lit warm (drawn, not modelled) */

const glow = (g: CanvasRenderingContext2D, x: number, y: number, rad: number, a = 0.55) => {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, `rgba(255,236,196,${a})`); gr.addColorStop(1, "rgba(255,236,196,0)");
  g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
};
const person = (g: CanvasRenderingContext2D, x: number, y: number, s: number, shirt: string) => {
  g.fillStyle = shirt;
  g.beginPath(); g.roundRect(x - 13 * s, y, 26 * s, 34 * s, 9 * s); g.fill();
  g.fillStyle = "#5b4033";
  g.beginPath(); g.arc(x, y - 9 * s, 9 * s, 0, Math.PI * 2); g.fill();
};
const plant = (g: CanvasRenderingContext2D, x: number, y: number, s: number) => {
  g.fillStyle = "#c9b8a3"; g.fillRect(x - 9 * s, y - 16 * s, 18 * s, 16 * s);
  g.fillStyle = "#5f7d4c";
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(x + (i - 3) * 4 * s, y - 26 * s - (i % 3) * 7 * s, 6 * s, 13 * s, (i - 3) * 0.35, 0, Math.PI * 2); g.fill(); }
};

const officeWall = (seed: number, purple = false) => canvasTexture(2048, 192, (g, w, h, r) => {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#f8f0e2"); bg.addColorStop(1, "#e9d7bd");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (purple) { g.fillStyle = "#7c4ee4"; g.fillRect(w * 0.18, h * 0.12, w * 0.09, h * 0.42); g.fillStyle = "#f5efff"; g.font = "600 34px Inter, sans-serif"; g.textAlign = "center"; g.fillText("Lumen", w * 0.225, h * 0.38); }
  // shelving + art
  for (let i = 0; i < 8; i++) {
    const x = 40 + r() * (w - 160);
    if (purple && x > w * 0.14 && x < w * 0.3) continue;
    g.fillStyle = "#cdb595"; g.fillRect(x, h * 0.3, 90, 4);
    for (let k = 0; k < 6; k++) { g.fillStyle = ["#8f6b52", "#3e5a6b", "#c47f4b", "#56704c"][(k + i) % 4]; g.fillRect(x + 6 + k * 13, h * 0.3 - 18 - r() * 6, 9, 18); }
  }
  for (let i = 0; i < 13; i++) glow(g, (i + 0.5) * (w / 13), 10, 70, 0.5);
  // desks, screens, people
  g.fillStyle = "#6e5847"; g.fillRect(0, h * 0.68, w, 8);
  const shirts = ["#3f4b5c", "#8a6e5a", "#4f6b5b", "#9b8f84", "#2f3a46", "#a0644a"];
  for (let i = 0; i < 16; i++) {
    const x = 60 + i * (w - 120) / 15 + (r() - 0.5) * 30;
    if (r() > 0.35) person(g, x, h * 0.52, 1.25, shirts[(i + seed) % shirts.length]);
    g.fillStyle = "#1f2228"; g.fillRect(x + 18, h * 0.52, 34, 22);
    g.fillStyle = "rgba(160,200,255,.35)"; g.fillRect(x + 20, h * 0.52 + 2, 30, 18);
  }
  plant(g, 26, h * 0.68, 1.6); plant(g, w - 26, h * 0.68, 1.6);
  g.fillStyle = "rgba(90,60,30,.18)"; g.fillRect(0, h * 0.68 + 8, w, h);
}, { repeat: false, seed });

const cafeWall = () => canvasTexture(1024, 288, (g, w, h, r) => {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#f6e6cd"); bg.addColorStop(1, "#d9b78f");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // menu boards
  for (const x of [w * 0.56, w * 0.74]) {
    g.fillStyle = "#26302b"; g.fillRect(x, h * 0.12, w * 0.15, h * 0.26);
    g.fillStyle = "rgba(245,236,220,.75)";
    for (let k = 0; k < 6; k++) g.fillRect(x + 14, h * 0.17 + k * 11, w * 0.15 * (0.4 + r() * 0.4), 3);
  }
  // shelves with cups and beans
  g.fillStyle = "#8a6544";
  for (const y of [0.24, 0.38]) {
    g.fillRect(w * 0.06, h * y, w * 0.4, 5);
    for (let k = 0; k < 12; k++) { g.fillStyle = k % 3 ? "#f4f1ea" : "#c46b3d"; g.fillRect(w * 0.07 + k * 34, h * y - 18, 20, 18); g.fillStyle = "#8a6544"; }
  }
  for (let i = 0; i < 6; i++) { const x = (i + 0.5) * (w / 6); g.strokeStyle = "#2b2420"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 34); g.stroke(); g.fillStyle = "#2b2420"; g.beginPath(); g.arc(x, 40, 12, Math.PI, 0); g.fill(); glow(g, x, 46, 90, 0.7); }
  // counter, espresso machine, people
  g.fillStyle = "#5b3d29"; g.fillRect(0, h * 0.62, w * 0.62, h);
  g.fillStyle = "#3b2819"; g.fillRect(0, h * 0.62, w * 0.62, 8);
  g.fillStyle = "#b9bcc0"; g.fillRect(w * 0.2, h * 0.47, 120, 42);
  g.fillStyle = "#7d8186"; g.fillRect(w * 0.2 + 10, h * 0.47 + 30, 100, 8);
  person(g, w * 0.36, h * 0.43, 1.6, "#2f3a46");
  person(g, w * 0.78, h * 0.5, 1.8, "#a0644a");
  person(g, w * 0.88, h * 0.52, 1.7, "#4f6b5b");
  g.fillStyle = "#6e4b33"; g.fillRect(w * 0.7, h * 0.7, w * 0.25, 8);
  plant(g, w * 0.97, h * 0.86, 2.4);
}, { repeat: false, seed: 41 });

/** Text painted onto a transparent plane (signage). */
const lettering = (text: string, font: string, color: string, w = 1024, h = 192, bg?: string) => canvasTexture(w, h, (g) => {
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);
}, { repeat: false });

const cupBadge = () => canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = "#24382f"; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#f3ead8"; g.lineWidth = 9; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#f3ead8";
  g.beginPath(); g.moveTo(84, 92); g.lineTo(172, 92); g.lineTo(160, 182); g.lineTo(96, 182); g.closePath(); g.fill();
  g.fillStyle = "#7c4ee4"; g.fillRect(88, 118, 80, 26);
  g.fillStyle = "#f3ead8"; g.fillRect(78, 80, 100, 12);
}, { repeat: false });

/* ---------------------------------------------------------------- geometry helpers */

/** A box whose UVs are in metres, so tiled textures keep their scale on any size. */
function box(w: number, h: number, d: number, tile = 1) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
  }
  return geo;
}

type Mats = Record<string, THREE.Material>;

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/** An open-fronted room: back wall art, floor, ceiling and sides, lit (unlit material = it glows). Front at z=0. */
function room(w: number, h: number, d: number, back: THREE.Texture, floorColor = 0xc79f75) {
  const g = new THREE.Group();
  const basic = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(o);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic({ map: back }));
  wall.position.set(0, h / 2, -d);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), basic({ color: floorColor }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.001, -d / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), basic({ color: 0xfff1dc }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, h - 0.001, -d / 2);
  const sideMat = basic({ color: 0xe8d6bd });
  // side walls sit a hair inside the room's width: flush with the building's own inner walls they'd
  // fight it for the same pixels and flicker as the model turns (worst on phones' shallower depth buffers)
  const inset = w / 2 - 0.015;
  const l = new THREE.Mesh(new THREE.PlaneGeometry(d, h), sideMat);
  l.rotation.y = Math.PI / 2; l.position.set(-inset, h / 2, -d / 2);
  const r = new THREE.Mesh(new THREE.PlaneGeometry(d, h), sideMat);
  r.rotation.y = -Math.PI / 2; r.position.set(inset, h / 2, -d / 2);
  g.add(wall, floor, ceil, l, r);
  return g;
}

/** Glass with black mullions; `cols` panes across, optional transom. Centre-bottom at origin, in the xy plane. */
function glazing(w: number, h: number, cols: number, m: Mats, transom?: number, frame = 0.05) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m.glass);
  glass.position.set(0, h / 2, 0); glass.renderOrder = 2;
  g.add(glass);
  const bar = (bw: number, bh: number, x: number, y: number) => g.add(mesh(box(bw, bh, 0.06), m.metal, x, y, 0.01));
  bar(w + frame, frame, 0, h);           // head
  bar(w + frame, frame * 1.4, 0, 0);     // sill
  for (let i = 0; i <= cols; i++) bar(frame, h, -w / 2 + (i * w) / cols, h / 2);
  if (transom) bar(w, frame * 0.8, 0, transom);
  return g;
}

function tree(m: Mats, x: number, y: number, z: number, s = 1, r = Math.random) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.7 * s, 8), m.trunk, 0, 0.35 * s, 0));
  for (let i = 0; i < 4; i++) {
    const f = mesh(new THREE.IcosahedronGeometry((0.3 + r() * 0.12) * s, 1), m.leaf, (r() - 0.5) * 0.3 * s, (0.75 + r() * 0.35) * s, (r() - 0.5) * 0.3 * s);
    f.scale.y = 0.85;
    g.add(f);
  }
  g.position.set(x, y, z);
  return g;
}

/* ---------------------------------------------------------------- the models */

function startupHQ(m: Mats, tx: Record<string, THREE.Texture>) {
  const g = new THREE.Group();
  const r = seeded(99);
  const W = 12.4, D = 4.6, y0 = 0.12, gH = 1.45, sp = 0.4, wH = 0.85, roof = 0.3;
  const H = gH + sp + wH + sp + wH + roof;          // to the roof top
  const front = D / 2, bay = 1.15;                  // the front 1.15 m holds the rooms you see into

  g.add(mesh(box(W + 0.5, 0.12, D + 0.5, 1), m.concrete, 0, 0.06, 0));
  // solid volume behind the rooms, and the two end walls that frame them
  g.add(mesh(box(W, H, D - bay, 1), m.clad, 0, y0 + H / 2, -bay / 2));
  for (const s of [-1, 1]) g.add(mesh(box(0.28, H, bay, 1), m.clad, s * (W / 2 - 0.14), y0 + H / 2, front - bay / 2));

  // ground floor: lobby behind a recessed glass wall, wood soffit above
  const inner = W - 0.56, recess = 0.42;
  const lobby = room(inner, gH, bay - recess - 0.02, tx.lobby, 0xd8c3a5);
  lobby.position.set(0, y0, front - recess); g.add(lobby);
  const gl0 = glazing(inner, gH, 11, m, gH * 0.78); gl0.position.set(0, y0, front - recess); g.add(gl0);
  const soffit = new THREE.Mesh(new THREE.PlaneGeometry(inner, recess), m.wood);
  soffit.rotation.x = Math.PI / 2; soffit.position.set(0, y0 + gH - 0.001, front - recess / 2); g.add(soffit);
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), m.lamp);
    l.rotation.x = Math.PI / 2; l.position.set(-inner / 2 + 0.7 + i * (inner - 1.4) / 8, y0 + gH - 0.004, front - recess / 2); g.add(l);
  }

  // two office floors: spandrel, then a ribbon window onto a lit room
  let y = y0 + gH;
  for (let f = 0; f < 2; f++) {
    g.add(mesh(box(W, sp, bay, 1), m.clad, 0, y + sp / 2, front - bay / 2));
    y += sp;
    const office = room(inner, wH, bay - 0.06, f ? tx.office2 : tx.office1);
    office.position.set(0, y, front - 0.04); g.add(office);
    const gl = glazing(inner, wH, 9, m); gl.position.set(0, y, front - 0.04); g.add(gl);
    y += wH;
  }
  g.add(mesh(box(W, roof, bay, 1), m.clad, 0, y + roof / 2, front - bay / 2));

  // wood fins over the right end of the office floors
  const finTop = y, finBot = y0 + gH + sp;
  for (let i = 0; i < 22; i++) {
    g.add(mesh(box(0.05, finTop - finBot, 0.14, 1), m.wood, -W / 2 + 4.2 + i * 0.13, (finTop + finBot) / 2, front + 0.08));
  }

  // roof: parapet, stair core, planters with trees
  const top = y0 + H;
  for (const [w, d, x, z] of [[W, 0.12, 0, D / 2 - 0.06], [W, 0.12, 0, -D / 2 + 0.06], [0.12, D, -W / 2 + 0.06, 0], [0.12, D, W / 2 - 0.06, 0]] as const) {
    g.add(mesh(box(w, 0.22, d, 1), m.clad, x, top + 0.11, z));
  }
  g.add(mesh(box(1.7, 0.95, 1.5, 1), m.clad, -W / 2 + 1.4, top + 0.475, -D / 2 + 1.1));
  const planter = mesh(box(3.2, 0.32, 0.5, 1), m.wood, -W / 2 + 3.4, top + 0.16, D / 2 - 0.55); g.add(planter);
  for (let i = 0; i < 3; i++) g.add(tree(m, -W / 2 + 2.3 + i * 1.1, top + 0.3, D / 2 - 0.55, 0.8, r));

  // the startup's name on the first spandrel, and a little life at street level
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.32), m.signHQ);
  sign.position.set(-W / 2 + 1.55, y0 + gH + sp / 2, front + 0.003); g.add(sign);
  g.add(mesh(box(1.6, 0.4, 0.55, 1), m.concrete, -W / 2 - 0.2, 0.32, front + 0.75));
  g.add(tree(m, -W / 2 - 0.6, 0.52, front + 0.75, 0.95, r));
  g.add(tree(m, -W / 2 + 0.2, 0.52, front + 0.75, 0.75, r));

  return { group: g, size: new THREE.Vector3(W + 0.5, top + 1, D + 1.5) };
}

function cornerCafe(m: Mats, tx: Record<string, THREE.Texture>) {
  const g = new THREE.Group();
  const r = seeded(7);
  const W = 5.6, D = 3.8, y0 = 0.1, H = 2.6, t = 0.26, front = D / 2;
  const sillY = 0.5, headY = 2.05, doorW = 1.0, pierL = 0.46, pierR = 0.38, pierM = 0.24;

  // sidewalk slab, reaching forward for the tables
  g.add(mesh(box(W + 2.2, 0.1, D + 2.4, 1), m.concrete, 0, 0.05, 0.7));

  // brick shell
  g.add(mesh(box(W, H, t, 1), m.brick, 0, y0 + H / 2, -front + t / 2));
  for (const s of [-1, 1]) g.add(mesh(box(t, H, D, 1), m.brick, s * (W / 2 - t / 2), y0 + H / 2, 0));
  g.add(mesh(box(W, 0.14, D, 1), m.roof, 0, y0 + H - 0.07, 0));
  // front: piers, sign band, parapet with a stone cap
  const fz = front - t / 2;
  g.add(mesh(box(pierL, headY, t, 1), m.brick, -W / 2 + pierL / 2, y0 + headY / 2, fz));
  g.add(mesh(box(pierR, headY, t, 1), m.brick, W / 2 - pierR / 2, y0 + headY / 2, fz));
  const doorX = W / 2 - pierR - doorW / 2;
  const winL = -W / 2 + pierL, winR = doorX - doorW / 2 - pierM;
  g.add(mesh(box(pierM, headY, t, 1), m.brick, winR + pierM / 2, y0 + headY / 2, fz));
  g.add(mesh(box(W, H - headY + 0.55, t, 1), m.brick, 0, y0 + headY + (H - headY + 0.55) / 2, fz));
  g.add(mesh(box(W + 0.12, 0.08, t + 0.08, 1), m.concrete, 0, y0 + H + 0.59, fz));
  // painted sign band
  const band = mesh(box(W - 0.5, 0.42, 0.04, 1), m.paint, 0, y0 + headY + 0.3, front + 0.02); g.add(band);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.38), m.signCafe);
  name.position.set(0, y0 + headY + 0.3, front + 0.042); g.add(name);

  // storefront window over a painted bulkhead, and the door
  const winW = winR - winL, winC = (winL + winR) / 2;
  g.add(mesh(box(winW, sillY, 0.12, 1), m.paint, winC, y0 + sillY / 2, front - 0.08));
  const inside = room(W - 2 * t, headY - 0.02, D - 2 * t - 0.05, tx.cafe, 0x8c6a4d);
  inside.position.set(0, y0 + 0.01, front - t + 0.02); g.add(inside);
  const shop = glazing(winW, headY - sillY, 2, m, (headY - sillY) * 0.8); shop.position.set(winC, y0 + sillY, front - 0.1); g.add(shop);
  const door = glazing(doorW, headY, 1, m, headY * 0.82, 0.07); door.position.set(doorX, y0, front - 0.1); g.add(door);
  g.add(mesh(box(0.03, 0.4, 0.05, 1), m.brass, doorX + doorW / 2 - 0.16, y0 + 1.05, front - 0.04));

  // striped awning over the window and door, on two black arms
  const aw = W - 0.6, ad = 0.95, drop = 0.32;
  const awning = mesh(box(aw, 0.025, Math.hypot(ad, drop), 1), m.awning, 0, y0 + headY - drop / 2 + 0.02, front + ad / 2);
  awning.rotation.x = Math.atan2(drop, ad); g.add(awning);
  g.add(mesh(box(aw, 0.2, 0.02, 1), m.awning, 0, y0 + headY - drop - 0.07, front + ad + 0.01));
  for (const s of [-1, 1]) {
    const arm = mesh(box(0.025, 0.025, 1.0, 1), m.metal, s * (aw / 2 - 0.1), y0 + headY - 0.35, front + 0.42);
    arm.rotation.x = -0.35; g.add(arm);
  }

  // blade sign with a cup on the corner pier
  g.add(mesh(box(0.03, 0.03, 0.55, 1), m.metal, W / 2 - 0.12, y0 + headY + 0.62, front + 0.27));
  const blade = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), m.badge);
  blade.rotation.y = Math.PI / 2; blade.position.set(W / 2 - 0.12, y0 + headY + 0.34, front + 0.4); g.add(blade);
  const blade2 = blade.clone(); blade2.rotation.y = -Math.PI / 2; blade2.position.x += 0.004; g.add(blade2);

  // outside: bistro tables, chairs, cups in Divvit sleeves, planters, a sandwich board
  const table = (x: number, z: number) => {
    const tg = new THREE.Group();
    tg.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 32), m.marble, 0, 0.74, 0));
    tg.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 10), m.metal, 0, 0.37, 0));
    tg.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 24), m.metal, 0, 0.01, 0));
    for (const [cx, cz] of [[-0.09, 0.04], [0.1, -0.06]]) {
      tg.add(mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.11, 18), m.cup, cx, 0.81, cz));
      tg.add(mesh(new THREE.CylinderGeometry(0.0405, 0.036, 0.045, 18), m.sleeve, cx, 0.8, cz, false));
    }
    for (const s of [-1, 1]) {
      const ch = new THREE.Group();
      ch.add(mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 24), m.metal, 0, 0.46, 0));
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.78; ch.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6), m.metal, Math.cos(a) * 0.13, 0.23, Math.sin(a) * 0.13)); }
      ch.add(mesh(box(0.36, 0.3, 0.025, 1), m.metal, 0, 0.66, s * 0.17));
      ch.position.set(s * 0.48, 0, 0); ch.rotation.y = s * Math.PI / 2;
      tg.add(ch);
    }
    tg.position.set(x, 0.1, z);
    return tg;
  };
  g.add(table(-1.45, front + 1.45), table(0.35, front + 1.55));
  for (const x of [doorX - doorW / 2 - 0.36, W / 2 + 0.2]) {
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 20), m.pot, x, 0.31, front + 0.3));
    g.add(tree(m, x, 0.4, front + 0.3, 0.75, r));
  }
  const board = new THREE.Group();
  for (const s of [-1, 1]) { const p = mesh(box(0.46, 0.68, 0.03, 1), m.chalk, 0, 0.36, s * 0.1); p.rotation.x = s * 0.16; board.add(p); }
  board.position.set(-W / 2 + 0.2, 0.1, front + 2.15); board.rotation.y = 0.5; g.add(board);
  // roof unit
  g.add(mesh(box(0.9, 0.45, 0.7, 1), m.unit, -0.8, y0 + H + 0.22, -0.6));

  return { group: g, size: new THREE.Vector3(W + 2.2, H + 1, D + 2.4) };
}

/* ---------------------------------------------------------------- stage */

export function mountBuilding(canvas: HTMLCanvasElement, kind: BuildingKind) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c4, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2e2, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const tx: Record<string, THREE.Texture> = {
    lobby: officeWall(3, true), office1: officeWall(1), office2: officeWall(4), cafe: cafeWall(),
  };
  const clad = boards([46, 47, 50]), cladBump = boards([0, 0, 0], true), brk = brick(), brkBump = brick(true);
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const m: Mats = {
    clad: std({ map: clad, bumpMap: cladBump, bumpScale: 0.6, roughness: 0.82, color: 0xffffff }),
    concrete: std({ map: concrete(), roughness: 0.92 }),
    wood: std({ map: oak(), roughness: 0.62 }),
    metal: std({ color: 0x1d1e21, roughness: 0.42, metalness: 0.55 }),
    glass: std({ color: 0xdfe8ee, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, envMapIntensity: 1.3, depthWrite: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff2d6 }),
    leaf: std({ color: 0x6d8b55, roughness: 0.9 }),
    trunk: std({ color: 0x5a4636, roughness: 0.9 }),
    signHQ: new THREE.MeshBasicMaterial({ map: lettering("LUMEN", "600 150px Inter, sans-serif", "#f4f1ff"), transparent: true }),
    brick: std({ map: brk, bumpMap: brkBump, bumpScale: 0.9, roughness: 0.88 }),
    roof: std({ color: 0x3a3a3c, roughness: 0.9 }),
    paint: std({ color: 0x24382f, roughness: 0.55 }),
    signCafe: new THREE.MeshBasicMaterial({ map: lettering("Corner Coffee", "italic 128px 'Instrument Serif', Georgia, serif", "#f3ead8"), transparent: true }),
    awning: std({ map: stripes(), roughness: 0.85, side: THREE.DoubleSide }),
    brass: std({ color: 0xb08d57, roughness: 0.3, metalness: 0.9 }),
    badge: new THREE.MeshStandardMaterial({ map: cupBadge(), roughness: 0.6 }),
    marble: std({ color: 0xf4f2ee, roughness: 0.25 }),
    cup: std({ color: 0xfbfaf7, roughness: 0.55 }),
    sleeve: std({ color: 0x7c4ee4, roughness: 0.7 }),
    pot: std({ color: 0xb4694a, roughness: 0.8 }),
    chalk: std({ color: 0x2a2d2b, roughness: 0.95 }),
    unit: std({ color: 0xb9bcbf, roughness: 0.6, metalness: 0.3 }),
  };

  const model = kind === "startup" ? startupHQ(m, tx) : cornerCafe(m, tx);
  scene.add(model.group);

  // transparent ground that only shows shadow, plus a soft contact shadow
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: 0x1d1a2a, opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const ao = canvasTexture(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(20,16,30,.38)"); gr.addColorStop(0.6, "rgba(20,16,30,.12)"); gr.addColorStop(1, "rgba(20,16,30,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(model.size.x * 1.25, model.size.z * 1.35), new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002;
  scene.add(contact);

  // framing, like an architectural photo: a long lens from far off and a little to one side, so the
  // facade reads almost flat with a sliver of end wall, and runs off the edge of the frame
  // (the startup off the right, the café — mirrored — off the left)
  const startup = kind === "startup";
  const baseFov = startup ? 8.6 : 7.8;
  // the camera stands 30+ units off: a near plane at 10 (not 1) spends the depth buffer where the building is
  const camera = new THREE.PerspectiveCamera(baseFov, 1, 10, 120);
  const view = startup
    ? { pos: new THREE.Vector3(-16, 5.2, 39), look: new THREE.Vector3(-2.3, 2.55, 0) }
    : { pos: new THREE.Vector3(14.5, 4.0, 31), look: new THREE.Vector3(0.2, 1.65, 0.9) };
  sun.position.set(startup ? -6 : 6, 9, 7);
  sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera;
  Object.assign(sc, { left: -9, right: 9, top: 9, bottom: -6, near: 1, far: 30 });
  sc.updateProjectionMatrix();

  let yaw = 0, w = 0, h = 0, queued = 0;
  const render = () => {
    queued = 0;
    model.group.rotation.y = yaw;
    contact.rotation.z = yaw;
    renderer.render(scene, camera);
  };
  const request = () => { if (!queued) queued = requestAnimationFrame(render); };

  const resize = () => {
    w = canvas.clientWidth; h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.copy(view.pos);
    // framed for a ~1.7:1 canvas; on narrower ones keep the same horizontal framing (more sky, same building)
    const A0 = 1.7, base = THREE.MathUtils.degToRad(baseFov) / 2;
    camera.fov = camera.aspect >= A0 ? baseFov : THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(base) * A0) / camera.aspect));
    camera.lookAt(view.look);
    camera.updateProjectionMatrix();
    request();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // the signs use web fonts: repaint them once the fonts have loaded
  const paintSigns = () => {
    const hq = m.signHQ as THREE.MeshBasicMaterial, cafe = m.signCafe as THREE.MeshBasicMaterial;
    hq.map?.dispose(); hq.map = lettering("LUMEN", "600 150px Inter, sans-serif", "#f4f1ff"); hq.needsUpdate = true;
    cafe.map?.dispose(); cafe.map = lettering("Corner Coffee", "italic 128px 'Instrument Serif', Georgia, serif", "#f3ead8"); cafe.needsUpdate = true;
    request();
  };
  document.fonts?.ready.then(paintSigns);

  return {
    /** 0 → section entering from below, 1 → leaving at the top */
    setProgress(p: number) {
      const k = Math.max(0, Math.min(1, p));
      yaw = (startup ? -0.07 : 0.07) + (startup ? 0.12 : -0.12) * k;
      request();
    },
    dispose() {
      cancelAnimationFrame(queued);
      ro.disconnect();
      scene.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.geometry) me.geometry.dispose();
        const mats = me.material ? (Array.isArray(me.material) ? me.material : [me.material]) : [];
        mats.forEach((x) => { (x as THREE.MeshStandardMaterial).map?.dispose(); (x as THREE.MeshStandardMaterial).bumpMap?.dispose(); x.dispose(); });
      });
      Object.values(tx).forEach((t) => t.dispose());
      env.dispose();
      renderer.dispose();
    },
  };
}
