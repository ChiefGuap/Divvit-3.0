"use client";

/* A 3D cup wearing the startup's sleeve design — the same cup as the landing
   page. Drag to spin; it turns slowly on its own when left alone. */

import React from "react";
import type { CupStage } from "@/lib/cup/stage";

export function CupMockup({ design, base, className, hint = true }: {
  design: HTMLCanvasElement | null; base: string; className?: string; hint?: boolean;
}) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const stageRef = React.useRef<CupStage | null>(null);
  const rot = React.useRef(0);
  const [ready, setReady] = React.useState(false);
  const firstPour = React.useRef(true);

  React.useEffect(() => {
    let stage: CupStage | null = null, raf = 0, disposed = false;
    const cleanups: (() => void)[] = [];
    import("@/lib/cup/stage").then(({ createCupStage }) => import("three").then((THREE) => {
      if (disposed || !canvas.current || !wrap.current) return;
      stage = createCupStage(canvas.current);
      stageRef.current = stage;
      const el = wrap.current;
      const { camera } = stage;
      const look = new THREE.Vector3(0, 0.66, 0);

      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        stage!.setSize(w, h);
        const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const dist = Math.max(0.98 / tanH, 0.78 / (tanH * camera.aspect));
        const elev = THREE.MathUtils.degToRad(12);
        camera.position.set(0, look.y + Math.sin(elev) * dist, Math.cos(elev) * dist);
        camera.lookAt(look);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      cleanups.push(() => ro.disconnect());
      fit();

      let vel = 0, dragging = false, lastX = 0, lastT = 0, lastInput = 0;
      const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0; el.setPointerCapture(e.pointerId); el.classList.add("dragging"); };
      const move = (e: PointerEvent) => {
        if (!dragging) return;
        const now = performance.now(), dx = e.clientX - lastX, dt = Math.max(1, now - lastT) / 1000;
        rot.current += dx * 0.01;
        vel = vel * 0.5 + ((dx * 0.01) / dt) * 0.5;
        lastX = e.clientX; lastT = now; lastInput = now;
      };
      const up = () => { dragging = false; el.classList.remove("dragging"); if (performance.now() - lastT > 80) vel = 0; lastInput = performance.now(); };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      cleanups.push(() => {
        el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      });

      let prev = performance.now();
      const frame = (now: number) => {
        if (disposed) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
        prev = now;
        if (!dragging) {
          vel *= Math.exp(-dt * 2.2);                                   // inertia
          const idle = now - lastInput > 2500;
          rot.current += (vel + (idle ? -0.35 : 0)) * dt;               // then a slow idle turn
        }
        stage!.cup.rotation.y = rot.current;
        stage!.update(dt, now / 1000);
        stage!.render();
      };
      raf = requestAnimationFrame(frame);
      setReady(true);
    }));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((f) => f());
      stage?.dispose();
      stageRef.current = null;
    };
  }, []);

  // pour each new design in, centred on whatever side currently faces the camera
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || !design) return;
    const u0 = (((-rot.current / (Math.PI * 2)) % 1) + 1) % 1;
    stage.pour(design, { base, offset: 0.5 - u0, first: firstPour.current, duration: 0.8 });
    firstPour.current = false;
  }, [ready, design, base]);

  return (
    <div ref={wrap} className={`mp-mockup${className ? ` ${className}` : ""}`}>
      <canvas ref={canvas} />
      {hint && <div className="mp-mockup-hint">Drag to spin · this is how your sleeve will look</div>}
    </div>
  );
}
