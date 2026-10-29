/* The landing-page showcase: a 3D coffee cup that spins on its own (or by
   drag), pours a new startup's sleeve every 90° of spin, and orbits four
   campaign-metric cards around itself.

   Framework-free: `mountShowcase(root)` wires up the markup rendered by
   <Showcase/> (elements tagged data-lp="...") and returns a cleanup. */

import * as THREE from "three";
import gsap from "gsap";
import { createCupStage, CUP_H, CUP_RB, rAt, SLV } from "@/lib/cup/stage";
import { drawSleeve, loadSleeveFonts } from "@/lib/cup/textures";
import { SHOWCASE, type ShowcaseStartup } from "./data";

type Metric =
  | { type: "duration"; label: string; value: number; unit: string; weeks: number; sub: string }
  | { type: "cafes"; label: string; value: number; unit: string; sub: string }
  | { type: "sleeves"; label: string; value: number; series: number[]; sub: string }
  | { type: "engage"; label: string; value: number; rate: number; items: [string, number][]; total: number };

// The four cards, in slot order: left-top, left-bottom, right-top, right-bottom
function metricsFor(s: ShowcaseStartup): Metric[] {
  const c = s.campaign;
  const sleeves = c.weeklySleeves.reduce((a, b) => a + b, 0);
  const eng = c.engagements.reduce((a, [, v]) => a + v, 0);
  let run = 0;
  return [
    { type: "duration", label: "Campaign duration", value: c.weeks, unit: c.weeks === 1 ? "week" : "weeks", weeks: c.weeks, sub: c.dates },
    { type: "cafes", label: "Café placements", value: c.cafes, unit: c.cafes === 1 ? "café" : "cafés", sub: `across ${c.city}` },
    { type: "sleeves", label: "Cup sleeves placed", value: sleeves, series: c.weeklySleeves.map((v) => (run += v)),
      sub: `≈ ${Math.round(sleeves / c.cafes).toLocaleString("en-US")} per café` },
    { type: "engage", label: "Engagements", value: eng, rate: (eng / sleeves) * 100, items: c.engagements, total: eng },
  ];
}

const fmt = (v: number, dec = 0) => Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const numHTML = (value: number, unit?: string) =>
  `<span class="num" data-to="${value}" data-dec="0">0</span>${unit ? `<span class="unit">${unit}</span>` : ""}`;

function sparkPath(series: number[], w = 200, h = 52) {
  const lo = Math.min(...series), hi = Math.max(...series);
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 10)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return { d, end: pts[pts.length - 1], w, h };
}

let uid = 0;
function cardHTML(m: Metric) {
  const i = ++uid;
  switch (m.type) {
    case "duration":
      return `<div class="label">${m.label}</div><div class="big">${numHTML(m.value, m.unit)}</div>
        <div class="segs">${"<i><b></b></i>".repeat(m.weeks)}</div>
        <div class="foot"><span class="sub">${m.sub}</span></div>`;
    case "cafes": {
      const per = m.value <= 48 ? 1 : Math.ceil(m.value / 48);
      return `<div class="label">${m.label}</div><div class="big">${numHTML(m.value, m.unit)}</div>
        <div class="dotgrid">${"<i></i>".repeat(Math.ceil(m.value / per))}</div>
        <div class="foot"><span class="sub">${m.sub}${per > 1 ? ` · 1 dot = ${per} cafés` : ""}</span></div>`;
    }
    case "sleeves": {
      const p = sparkPath(m.series);
      return `<div class="label">${m.label}</div><div class="big">${numHTML(m.value)}</div>
        <svg class="spark" viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="none">
          <defs><linearGradient id="lp-sg${i}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient></defs>
          <path class="area" d="${p.d} L${p.w},${p.h} L0,${p.h} Z" fill="url(#lp-sg${i})"/>
          <path class="ln" d="${p.d}" vector-effect="non-scaling-stroke"/>
          <circle class="end" cx="${p.end[0]}" cy="${p.end[1]}" r="3.5"/>
        </svg>
        <div class="foot"><span class="sub">${m.sub}</span></div>`;
    }
    case "engage":
      return `<div class="label">${m.label}</div>
        <div class="bigrow"><div class="big">${numHTML(m.value)}</div><span class="pill">${m.rate.toFixed(1)}% of sleeves</span></div>
        <div class="stack">${m.items.map(([, v]) => `<b data-w="${((v / m.total) * 100).toFixed(2)}"></b>`).join("")}</div>
        <div class="legend">${m.items.map(([n, v]) => `<span>${n} <em>${Math.round((v / m.total) * 100)}%</em></span>`).join("")}</div>`;
  }
}

function animateCardIn(card: HTMLElement, m: Metric, at: number) {
  const tl = gsap.timeline({ delay: at });
  card.querySelectorAll<HTMLElement>(".num").forEach((el) => {
    const o = { v: 0 }, to = +el.dataset.to!, dec = +el.dataset.dec!;
    tl.to(o, { v: to, duration: 1.4, ease: "power3.out", onUpdate: () => { el.textContent = fmt(o.v, dec); } }, 0.15);
  });
  if (m.type === "duration")
    tl.to(card.querySelectorAll(".segs b"), { scaleX: 1, duration: 0.45, ease: "power2.out", stagger: Math.min(0.12, 1 / m.weeks) }, 0.2);
  if (m.type === "cafes")
    tl.from(card.querySelectorAll(".dotgrid i"), { scale: 0, opacity: 0, duration: 0.45, ease: "back.out(2)",
      stagger: { each: Math.min(0.03, 1.1 / m.value), from: "random" } }, 0.2);
  if (m.type === "sleeves") {
    const ln = card.querySelector<SVGPathElement>(".ln")!, L = ln.getTotalLength();
    ln.style.strokeDasharray = String(L);
    tl.fromTo(ln, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" }, 0.15);
    tl.from(card.querySelector(".area"), { opacity: 0, duration: 0.8 }, 0.8);
    tl.from(card.querySelector(".end"), { scale: 0, transformOrigin: "center", transformBox: "fill-box", duration: 0.6, ease: "back.out(1.8)" }, 1.3);
  }
  if (m.type === "engage") {
    card.querySelectorAll<HTMLElement>(".stack b").forEach((b, k) =>
      tl.to(b, { width: `calc(${b.dataset.w}% - 2px)`, duration: 0.9, ease: "power3.out" }, 0.25 + k * 0.15));
    tl.from(card.querySelectorAll(".legend span"), { opacity: 0, y: 4, duration: 0.5, stagger: 0.1, ease: "power2.out" }, 0.55);
    tl.from(card.querySelector(".pill"), { scale: 0.6, opacity: 0, duration: 0.7, ease: "back.out(1.6)" }, 0.85);
  }
}

/* ---------------------------------------------------------------- layout */

const SECTOR = Math.PI / 2;            // 90° of spin per startup
const SWITCH_AT = SECTOR * 0.5 + 0.06; // hysteresis so the boundary doesn't flicker
const DRAG = 0.0085;                   // radians per pixel
const AUTO_SPEED = 0.22;               // rad/s of idle spin (≈7s per startup)
const AUTO_DELAY = 3000;               // ms of no input before the cup turns on its own
const deg = (d: number) => (d * Math.PI) / 180;

type Slot = { side: string; ang?: number; y?: number; r?: number; sAng?: number; sy?: number; stackOn?: number };
// Wide: two cards either side of the cup, orbiting with it (y is re-fit on resize).
// Tall: a 2×2 block above the cup — the lower row hangs off the rim, the upper row stacks on it.
const LAYOUTS: Record<"wide" | "tall", Slot[]> = {
  wide: [
    { side: "l", ang: deg(-90), y: 1.04, r: 0.85, sAng: deg(-46), sy: 0.94 },
    { side: "l", ang: deg(-90), y: 0.26, r: 0.85, sAng: deg(-46), sy: 0.46 },
    { side: "r", ang: deg(90), y: 1.04, r: 0.85, sAng: deg(46), sy: 0.94 },
    { side: "r", ang: deg(90), y: 0.26, r: 0.85, sAng: deg(46), sy: 0.46 },
  ],
  tall: [
    { side: "tl", stackOn: 1 },
    { side: "tl", ang: deg(-2), y: 1.36, r: 0.6, sAng: deg(-30), sy: 1.1 },
    { side: "tr", stackOn: 3 },
    { side: "tr", ang: deg(2), y: 1.36, r: 0.6, sAng: deg(30), sy: 1.1 },
  ],
};
const SLOT_ORDER = [1, 3, 0, 2]; // position the rows that stacked cards sit on first
const SVGNS = "http://www.w3.org/2000/svg";
const mod = (n: number, m: number) => ((n % m) + m) % m;
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mountShowcase(root: HTMLElement, startups: ShowcaseStartup[] = SHOWCASE) {
  const $ = <T extends Element = HTMLElement>(k: string) => root.querySelector<T>(`[data-lp="${k}"]`)!;
  const canvas = $<HTMLCanvasElement>("gl");
  const stageEl = $("stage"), cardsEl = $("cards"), linesEl = $<SVGSVGElement>("lines");
  const hudTitle = $("hud-title"), hudBot = $("hud-bot"), dotsEl = $("dots");
  const N = startups.length;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(ev, fn as EventListener, opts);
    cleanups.push(() => el.removeEventListener(ev, fn as EventListener, opts));
  };

  const stage = createCupStage(canvas);
  const { camera, cup } = stage;
  const LOOK = new THREE.Vector3(0, 0.62, 0);
  const sleeveTex = new Map<number, THREE.Texture>();
  const getSleeveTex = (i: number) => {
    if (!sleeveTex.has(i)) {
      const s = startups[i];
      sleeveTex.set(i, stage.makeTexture(drawSleeve({
        base: s.sleeve.base, ink: s.sleeve.ink, name: s.name, tagline: s.tagline, font: s.font,
        backText: `${s.sector}  ·  ${s.campaign.city}  ·  Careful, it's hot`,
      })));
    }
    return sleeveTex.get(i)!;
  };

  /* ---------------- cards + leader lines ---------------- */
  let layout = LAYOUTS.wide;
  const slots = layout.map(() => {
    const anchor = document.createElement("div"); anchor.className = "anchor";
    const slot = document.createElement("div"); slot.className = "slot";
    anchor.appendChild(slot); cardsEl.appendChild(anchor);
    const line = document.createElementNS(SVGNS, "line");
    const halo = document.createElementNS(SVGNS, "circle"); halo.setAttribute("class", "halo"); halo.setAttribute("r", "6");
    const dot = document.createElementNS(SVGNS, "circle"); dot.setAttribute("class", "dot"); dot.setAttribute("r", "3");
    const g = document.createElementNS(SVGNS, "g"); g.append(line, halo, dot); linesEl.appendChild(g);
    return { anchor, slot, line, halo, dot, g, reveal: { v: 0 }, px: 0, py: 0, stackH: null as number | null };
  });

  startups.forEach(() => dotsEl.appendChild(document.createElement("i")));

  /* ---------------- HUD (name + one-liner under the cup) ---------------- */
  function setHUD(s: ShowcaseStartup, i: number, dir: number, tl: gsap.core.Timeline, first: boolean) {
    const eyebrow = $("eyebrow"), title = $("title"), tagline = $("tagline");
    const swap = () => {
      eyebrow.innerHTML = `<b>${String(i + 1).padStart(2, "0")}</b> / ${String(N).padStart(2, "0")} &nbsp;·&nbsp; ${s.sector} &nbsp;·&nbsp; ${s.campaign.city}`;
      title.style.fontFamily = `"${s.font.family}", Inter, sans-serif`;
      title.style.fontStyle = s.font.style;
      title.style.fontWeight = s.font.weight;
      title.innerHTML = [...s.name].map((c) => `<span class="ch">${c}</span>`).join("");
      tagline.textContent = s.tagline;
    };
    [...dotsEl.children].forEach((d, k) => d.classList.toggle("on", k === i));
    root.style.setProperty("--accent", s.accent);
    const parts = [eyebrow, title, tagline];
    const outT = first ? 0 : 0.35;
    if (!first) tl.to(parts, { opacity: 0, y: -8, filter: "blur(6px)", duration: 0.35, ease: "power2.in", stagger: 0.04 }, 0);
    tl.add(() => {
      swap();
      gsap.set(parts, { y: 0, filter: "blur(0px)", opacity: 1 });
      gsap.from(title.children, { yPercent: 45, opacity: 0, filter: "blur(8px)", duration: 0.9, ease: "power3.out", stagger: { each: 0.028, from: dir < 0 ? "end" : "start" } });
    }, outT + 0.1);
    tl.fromTo(eyebrow, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", immediateRender: false }, outT + 0.1);
    tl.fromTo(tagline, { opacity: 0, y: 8, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "power3.out", immediateRender: false }, outT + 0.35);
  }

  /* ---------------- switching ---------------- */
  let activeK = 0, activeIdx = -1;
  let tl: gsap.core.Timeline | null = null;

  function switchTo(k: number, dir: number) {
    const idx = mod(-k, N);
    activeK = k;
    if (idx === activeIdx) return;
    const first = activeIdx === -1;
    activeIdx = idx;
    const s = startups[idx];
    const metrics = metricsFor(s);

    // pour the new print; its logo sits where it'll face the camera once the cup reaches sector k
    const u0 = mod((-k * SECTOR) / (Math.PI * 2), 1);
    stage.pour(getSleeveTex(idx), { offset: 0.5 - u0, base: s.sleeve.base, first });

    slots.forEach((sl, i) => {
      sl.slot.querySelectorAll<HTMLElement>(".card").forEach((old) => {
        gsap.killTweensOf(old);
        gsap.to(old, { opacity: 0, y: -10, scale: 0.98, filter: "blur(6px)", duration: 0.55, ease: "power2.inOut", onComplete: () => old.remove() });
      });
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = cardHTML(metrics[i]);
      sl.slot.appendChild(card);
      const at = (first ? 0.1 : 0.3) + i * 0.08;
      gsap.fromTo(card, { opacity: 0, y: 14, scale: 0.98, filter: "blur(8px)" },
        { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 1, ease: "power3.out", delay: at });
      animateCardIn(card, metrics[i], at + 0.05);
      if (first) gsap.to(sl.reveal, { v: 1, duration: 0.9, ease: "power2.out", delay: at });
    });

    if (tl) tl.progress(1).kill();
    tl = gsap.timeline();
    setHUD(s, idx, dir, tl, first);
  }

  /* ---------------- interaction: drag / fling / snap / auto-spin ---------------- */
  let R = 0, vel = 0, target = 0, dragging = false, lastX = 0, lastT = 0, lastInput = performance.now(), autoVel = 0;
  let hintHidden = false;
  const hideHint = () => { if (!hintHidden) { hintHidden = true; $("hint").style.opacity = "0"; } };

  on(stageEl, "pointerdown", (e: PointerEvent) => {
    dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0; autoVel = 0;
    stageEl.setPointerCapture(e.pointerId); stageEl.classList.add("dragging");
    hideHint();
  });
  on(stageEl, "pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX, dt = Math.max(1, now - lastT) / 1000;
    R += dx * DRAG;
    vel = vel * 0.6 + ((dx * DRAG) / dt) * 0.4;
    lastX = e.clientX; lastT = now; lastInput = now;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false; stageEl.classList.remove("dragging");
    if (performance.now() - lastT > 80) vel = 0;
    const fling = THREE.MathUtils.clamp(vel * 0.18, -SECTOR * 0.6, SECTOR * 0.6); // a flick moves one startup, never several
    target = Math.round((R + fling) / SECTOR) * SECTOR;
  };
  on(stageEl, "pointerup", release);
  on(stageEl, "pointercancel", release);

  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  on(stageEl, "wheel", (e: WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!d) return;
    e.preventDefault();
    dragging = true; R -= d * 0.004; vel = 0; autoVel = 0; lastInput = performance.now(); hideHint();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { dragging = false; target = Math.round(R / SECTOR) * SECTOR; }, 140);
  }, { passive: false });

  const step = (n: number) => {
    // mid auto-spin, step from the startup on screen; otherwise stack repeated presses
    const from = autoVel > 0.001 ? activeK : Math.round(target / SECTOR);
    autoVel = 0;
    target = (from + n) * SECTOR;
    lastInput = performance.now(); hideHint();
  };
  on($("next"), "click", () => step(-1));
  on($("prev"), "click", () => step(1));
  on(window, "keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
    if (e.key === "ArrowRight") step(-1);
    if (e.key === "ArrowLeft") step(1);
  });

  /* ---------------- layout: fit everything in pixels ---------------- */
  let W = 0, Hh = 0, DRIFT = 0.45, CARD_W = 236;
  const v3 = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    v3.set(x, y, z).project(camera);
    return [((v3.x + 1) / 2) * W || 0, ((1 - v3.y) / 2) * Hh || 0];
  };

  function resize() {
    W = root.clientWidth; Hh = root.clientHeight;
    if (!W || !Hh) return;
    stage.setSize(W, Hh);
    const small = W <= 760;
    const navH = Hh - (hudBot.getBoundingClientRect().top - root.getBoundingClientRect().top) + (small ? 12 : 20);
    // leave room under the headline at the top
    const headline = $("banner");
    const titleH = Math.max(small ? 108 : 120, hudTitle.offsetHeight + 16), topPad = headline.offsetTop + headline.offsetHeight + (small ? 10 : 18);
    const avail = Hh - topPad - titleH - navH;
    const Yr = LAYOUTS.tall[1].y!;

    // try cards beside vs. above the cup, full-size vs. compact — keep whichever gives the biggest cup
    let best: { compact: boolean; tall: boolean; cw: number; ch: number; sc: number; score: number } | null = null;
    for (const compact of [false, true]) for (const tall of [false, true]) {
      const cw = compact ? 160 : 236, ch = compact ? 136 : 172;
      let sc: number, ok: boolean;
      if (tall) {
        ok = 2 * cw + 44 <= W;
        sc = Math.min((avail - ch * 2 - 18) / Yr, (0.46 * Hh) / CUP_H, (W - 40) / 1.2);
      } else {
        const sW = (W / 2 - cw - 40) / LAYOUTS.wide[0].r!;
        ok = sW >= 110;
        sc = Math.min(sW, (avail - ch / 2) / 1.04, (avail - ch - 10) / 0.65, (0.5 * Hh) / CUP_H);
      }
      const score = sc * (compact ? 0.8 : 1) * (tall ? 0.97 : 1);
      if (ok && (!best || score > best.score)) best = { compact, tall, cw, ch, sc, score };
    }
    const pick = best ?? { compact: true, tall: true, cw: 160, ch: 136, sc: 60, score: 0 };
    const CARD_H = pick.ch;
    CARD_W = pick.cw;
    root.classList.toggle("compact", pick.compact);
    layout = pick.tall ? LAYOUTS.tall : LAYOUTS.wide;
    DRIFT = pick.tall ? 0.12 : 0.45;
    slots.forEach((sl, i) => { sl.stackH = null; sl.anchor.dataset.side = layout[i].side; });

    const s = Math.max(60, pick.sc);
    let content: number;
    if (!pick.tall) {
      const half = Math.max(0.39, (CARD_H / 2 + 10) / s); // keep the two side cards apart when the cup is small
      LAYOUTS.wide.forEach((L, i) => { L.y = 0.65 + (i % 2 ? -half : half); });
      content = (0.65 + half) * s + CARD_H / 2;
    } else {
      content = CARD_H * 2 + 18 + Yr * s;
    }
    const baseY = Hh - navH - titleH - Math.max(0, avail - content) / 2;

    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Hh / (2 * s * tanH), elev = deg(13);
    const place = () => {
      camera.position.set(0, LOOK.y + Math.sin(elev) * dist, Math.cos(elev) * dist);
      camera.lookAt(LOOK); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    };
    LOOK.y = 0.6;
    for (let k = 0; k < 5; k++) { place(); LOOK.y -= (toScreen(0, 0, 0)[1] - baseY) / s; }
    place();
    hudTitle.style.top = `${Math.round(toScreen(0, 0, CUP_RB)[1] + (small ? 12 : 18))}px`;
    hudTitle.style.visibility = "visible";
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  cleanups.push(() => ro.disconnect());
  resize();

  /* ---------------- loop ---------------- */
  let prev = performance.now(), cardDelta = 0, raf = 0;
  // nothing to draw while the cup is scrolled out of view
  let onScreen = true;
  const vis = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; prev = performance.now(); });
  vis.observe(root);
  cleanups.push(() => vis.disconnect());

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (!onScreen) return;
    const dt = THREE.MathUtils.clamp((now - prev) / 1000, 0, 0.05);
    prev = now;
    const t = now / 1000;

    const idle = !dragging && now - lastInput > AUTO_DELAY;
    autoVel += ((idle ? AUTO_SPEED : 0) - autoVel) * (1 - Math.exp(-dt * (idle ? 0.9 : 8)));
    if (dragging) target = R;
    else if (idle) { R -= autoVel * dt; target = R; vel = -autoVel; }
    else { // critically-damped spring toward the snapped sector
      const k = 38, c = 2 * Math.sqrt(k);
      vel += (k * (target - R) - c * vel) * dt;
      R += vel * dt;
    }

    if (Math.abs(R - activeK * SECTOR) > SWITCH_AT) {
      const k = Math.round(R / SECTOR);
      if (k !== activeK) switchTo(k, Math.sign(activeK - k));
    }

    cup.rotation.y = R;
    // cards drift with the cup, softly and smoothed, so a switch glides instead of jumping
    cardDelta += ((R - activeK * SECTOR) * DRIFT - cardDelta) * (1 - Math.exp(-dt * 5));
    const delta = cardDelta;

    for (const i of SLOT_ORDER) {
      const s = slots[i], L = layout[i];
      let x: number, y: number, d = 1;
      if (L.stackOn !== undefined) {
        const below = slots[L.stackOn], h = below.slot.offsetHeight;
        s.stackH = s.stackH == null ? h : s.stackH + (h - s.stackH) * (1 - Math.exp(-dt * 10));
        x = below.px; y = below.py - s.stackH - 10;
      } else {
        const a = L.ang! + delta;
        d = Math.cos(a);
        [x, y] = toScreen(L.r! * Math.sin(a), L.y!, L.r! * Math.cos(a));
      }
      const leftSide = L.side === "l" || L.side === "tl", gap = L.side.length === 1 ? 14 : 6;
      x = leftSide ? Math.max(x, 12 + CARD_W + gap) : Math.min(x, W - 12 - CARD_W - gap);
      s.px = x; s.py = y;
      const vis = smooth(-0.62, -0.08, d);
      const sc = 0.9 + 0.1 * smooth(-1, 1, d);
      s.anchor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
      s.anchor.style.opacity = vis.toFixed(3);
      s.anchor.style.zIndex = String(Math.round(d * 100) + 100);

      if (L.stackOn !== undefined) { s.g.style.opacity = "0"; continue; }
      const sa = L.sAng! + delta;
      const inSleeve = L.sy! > SLV.y0 && L.sy! < SLV.y1;
      const sr = rAt(L.sy!) + (inSleeve ? SLV.off + 0.002 : 0.002);
      const [sx, sy] = toScreen(sr * Math.sin(sa), L.sy!, sr * Math.cos(sa));
      const facing = smooth(-0.05, 0.35, Math.cos(sa));
      const rv = s.reveal.v;
      s.line.setAttribute("x1", String(sx)); s.line.setAttribute("y1", String(sy));
      s.line.setAttribute("x2", String(sx + (x - sx) * rv)); s.line.setAttribute("y2", String(sy + (y - sy) * rv));
      s.dot.setAttribute("cx", String(sx)); s.dot.setAttribute("cy", String(sy));
      s.halo.setAttribute("cx", String(sx)); s.halo.setAttribute("cy", String(sy));
      s.g.style.opacity = (Math.min(vis, facing) * Math.min(1, rv * 2)).toFixed(3);
    }

    stage.update(dt, t);
    stage.render();
  }

  // wait for fonts so each sleeve prints in its own typeface, then pre-bake every print
  loadSleeveFonts(startups.map((s) => s.font)).then(() => {
    if (disposed) return;
    startups.forEach((_, i) => stage.renderer.initTexture(getSleeveTex(i)));
    switchTo(0, 1);
    raf = requestAnimationFrame(frame);
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(wheelTimer);
    if (tl) tl.kill();
    gsap.killTweensOf(root.querySelectorAll("*"));
    slots.forEach((s) => gsap.killTweensOf(s.reveal));
    cleanups.forEach((f) => f());
    cardsEl.innerHTML = "";
    linesEl.innerHTML = "";
    dotsEl.innerHTML = "";
    stage.dispose();
  };
}
