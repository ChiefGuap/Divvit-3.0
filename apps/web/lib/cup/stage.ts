/* The 3D paper cup: renderer, studio lighting, cup geometry, steam, and a
   sleeve whose print "pours" from one design to the next.

   Shared by the landing-page showcase and the marketplace's sleeve mockup.
   Units: 1 ≈ 10cm (a 12oz paper cup). */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import gsap from "gsap";
import {
  contactShadowTexture, latteTexture, luminance, paperTextures, rand, sleeveBumpTexture, steamTexture, toTexture,
} from "./textures";

export const CUP_H = 1.15;
export const CUP_RB = 0.3;
export const CUP_RT = 0.45;
export const rAt = (y: number) => CUP_RB + (CUP_RT - CUP_RB) * (y / CUP_H);
export const SLV = { y0: 0.3, y1: 0.8, off: 0.011 };
export const COFFEE_Y = 1.0;
const SEG = 160;

export type PourOptions = {
  /** texture u-offset so the design's centre faces the camera at a given rotation */
  offset?: number;
  /** sleeve stock colour — drives sheen, edge and inner colours */
  base: string;
  /** set instantly instead of pouring */
  first?: boolean;
  duration?: number;
};

export type CupStage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cup: THREE.Group;
  makeTexture(c: HTMLCanvasElement): THREE.Texture;
  pour(design: THREE.Texture | HTMLCanvasElement, opts: PourOptions): void;
  setSize(w: number, h: number): void;
  update(dt: number, t: number): void;
  render(): void;
  dispose(): void;
};

export function createCupStage(canvas: HTMLCanvasElement): CupStage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const owned: { dispose(): void }[] = [];   // textures/geometries/materials to free on dispose
  const own = <T extends { dispose(): void }>(o: T) => (owned.push(o), o);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  own(env);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(2.2, 3.6, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.6, bottom: -1, near: 0.5, far: 10 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc690, 2.2);
  rim.position.set(-2.6, 1.8, -2.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
  fill.position.set(-3, 1, 2);
  scene.add(fill);

  // ground: shadow catcher + soft contact shadow, tinted for Divvit's lilac background
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(10, 10)), own(new THREE.ShadowMaterial({ color: 0x2b1d5c, opacity: 0.3 })));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const contact = new THREE.Mesh(
    own(new THREE.PlaneGeometry(1.25, 1.25)),
    own(new THREE.MeshBasicMaterial({ map: own(contactShadowTexture()), transparent: true, depthWrite: false })),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.002;
  scene.add(contact);

  /* ---------------- cup body ---------------- */
  const cup = new THREE.Group();
  scene.add(cup);

  const paper = paperTextures(aniso);
  own(paper.map); own(paper.bump);
  const paperMat = own(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: paper.map, bumpMap: paper.bump, bumpScale: 0.6,
    roughness: 0.52, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff6ea),
  }));
  const innerMat = own(new THREE.MeshPhysicalMaterial({ color: 0xece5d9, roughness: 0.6, side: THREE.BackSide, bumpMap: paper.bump, bumpScale: 0.4 }));

  const outer = new THREE.Mesh(own(new THREE.LatheGeometry([
    new THREE.Vector2(CUP_RB - 0.012, 0.0), new THREE.Vector2(CUP_RB - 0.002, 0.006), new THREE.Vector2(CUP_RB, 0.02),
    new THREE.Vector2(rAt(CUP_H * 0.5), CUP_H * 0.5), new THREE.Vector2(rAt(CUP_H), CUP_H),
  ], SEG)), paperMat);
  outer.castShadow = outer.receiveShadow = true;
  cup.add(outer);

  const inner = new THREE.Mesh(own(new THREE.LatheGeometry([
    new THREE.Vector2(rAt(0.06) - 0.005, 0.06), new THREE.Vector2(rAt(CUP_H) - 0.005, CUP_H),
  ], SEG)), innerMat);
  inner.receiveShadow = true;
  cup.add(inner);

  const lip = new THREE.Mesh(own(new THREE.TorusGeometry(CUP_RT + 0.001, 0.0125, 24, SEG)), paperMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = CUP_H + 0.004;
  lip.castShadow = true;
  cup.add(lip);

  const coffee = new THREE.Mesh(
    own(new THREE.CircleGeometry(rAt(COFFEE_Y) - 0.004, SEG)),
    own(new THREE.MeshPhysicalMaterial({ map: own(latteTexture(aniso)), roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12 })),
  );
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = COFFEE_Y;
  coffee.receiveShadow = true;
  cup.add(coffee);
  const meniscus = new THREE.Mesh(
    own(new THREE.RingGeometry(rAt(COFFEE_Y) - 0.02, rAt(COFFEE_Y) - 0.003, SEG)),
    own(new THREE.MeshPhysicalMaterial({ color: 0x2a160b, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.6, depthWrite: false })),
  );
  meniscus.rotation.x = -Math.PI / 2;
  meniscus.position.y = COFFEE_Y + 0.0015;
  cup.add(meniscus);

  /* ---------------- sleeve ----------------
     One sleeve. A new design "pours" up from the bottom with a wavy liquid
     edge, blended in the shader between print A and print B. */
  const lathe = (r0: number, r1: number) => own(new THREE.LatheGeometry([
    new THREE.Vector2(rAt(SLV.y0) + r0, SLV.y0), new THREE.Vector2(rAt(SLV.y1) + r1, SLV.y1)], SEG));
  const edge = (y: number) => own(new THREE.LatheGeometry([new THREE.Vector2(rAt(y) + SLV.off, y), new THREE.Vector2(rAt(y) + 0.002, y)], SEG));

  const SU = {
    mapB: { value: null as THREE.Texture | null }, uMix: { value: 0 },
    uOffA: { value: 0 }, uOffB: { value: 0 }, uTime: { value: 0 },
  };
  const sleeveMat = own(new THREE.MeshPhysicalMaterial({
    bumpMap: own(sleeveBumpTexture()), bumpScale: 1.2, roughness: 0.86, sheen: 0.25, sheenColor: new THREE.Color(0xb9895b),
  }));
  sleeveMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SU);
    sh.fragmentShader = "uniform sampler2D mapB;\nuniform float uMix, uOffA, uOffB, uTime;\n" +
      sh.fragmentShader.replace("#include <map_fragment>", /* glsl */ `
        #ifdef USE_MAP
          vec4 cA = texture2D( map,  vec2( vMapUv.x + uOffA, vMapUv.y ) );
          vec4 cB = texture2D( mapB, vec2( vMapUv.x + uOffB, vMapUv.y ) );
          float ang = vMapUv.x * 6.28318;
          float wave = sin( ang * 7.0 + uTime * 1.6 ) * 0.035 + sin( ang * 19.0 - uTime * 2.3 ) * 0.012;
          float edge = uMix * 1.3 - 0.15;
          float y = vMapUv.y + wave * smoothstep( 0.0, 0.25, uMix ) * smoothstep( 1.0, 0.75, uMix );
          float m = 1.0 - smoothstep( edge - 0.045, edge + 0.045, y );
          float glint = exp( -pow( ( y - edge ) / 0.022, 2.0 ) ) * step( 0.001, uMix ) * step( uMix, 0.999 );
          vec4 c = mix( cA, cB, m );
          c.rgb += glint * 0.18;
          diffuseColor *= c;
        #endif
      `);
  };
  const sleeveEdgeMat = own(new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }));
  const sleeveInnerMat = own(new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.BackSide }));
  const sleeveOuter = new THREE.Mesh(lathe(SLV.off, SLV.off), sleeveMat);
  sleeveOuter.castShadow = sleeveOuter.receiveShadow = true;
  const sleeve = new THREE.Group();
  sleeve.add(sleeveOuter, new THREE.Mesh(lathe(0.002, 0.002), sleeveInnerMat),
    new THREE.Mesh(edge(SLV.y1), sleeveEdgeMat), new THREE.Mesh(edge(SLV.y0), sleeveEdgeMat));
  sleeve.visible = false; // until the first design arrives
  cup.add(sleeve);

  const makeTexture = (c: HTMLCanvasElement) => own(toTexture(c, aniso, true));
  const look = (base: string) => ({ base: new THREE.Color(base), rough: luminance(base) < 0.25 ? 0.62 : 0.86 });
  let tween: gsap.core.Tween | null = null;

  function pour(design: THREE.Texture | HTMLCanvasElement, opts: PourOptions) {
    const tex = design instanceof THREE.Texture ? design : makeTexture(design);
    const to = look(opts.base);
    const offset = opts.offset ?? 0;
    if (tween) { const t = tween; t.progress(1); t.kill(); } // commit any half-finished pour
    if (opts.first || !sleeveMat.map) {
      sleeveMat.map = tex;
      SU.uOffA.value = offset;
      sleeveMat.needsUpdate = true;
      sleeveMat.roughness = to.rough;
      sleeveMat.sheenColor.copy(to.base);
      sleeveEdgeMat.color.copy(to.base).multiplyScalar(0.8);
      sleeveInnerMat.color.copy(to.base).multiplyScalar(0.7);
      sleeve.visible = true;
      return;
    }
    SU.mapB.value = tex;
    SU.uOffB.value = offset;
    SU.uMix.value = 0;
    const from = { r: sleeveMat.roughness, c: sleeveMat.sheenColor.clone() };
    const tmp = new THREE.Color();
    tween = gsap.to(SU.uMix, {
      value: 1, duration: opts.duration ?? 1.25, ease: "power2.inOut",
      onUpdate() {
        const p = SU.uMix.value;
        sleeveMat.roughness = from.r + (to.rough - from.r) * p;
        tmp.copy(from.c).lerp(to.base, p);
        sleeveMat.sheenColor.copy(tmp);
        sleeveEdgeMat.color.copy(tmp).multiplyScalar(0.8);
        sleeveInnerMat.color.copy(tmp).multiplyScalar(0.7);
      },
      onComplete() {
        sleeveMat.map = tex;
        SU.uOffA.value = offset;
        SU.uMix.value = 0;
        tween = null;
      },
    });
  }

  /* ---------------- steam ---------------- */
  const steamTex = own(steamTexture());
  const steam = Array.from({ length: 16 }, (_, i) => {
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: steamTex, color: 0xcdc5e0, transparent: true, depthWrite: false, opacity: 0 })));
    sp.userData = { t: i / 16, speed: rand(0.07, 0.12), seed: rand(0, 100), x: rand(-0.12, 0.12) };
    scene.add(sp);
    return sp;
  });
  const smooth = (a: number, b: number, x: number) => {
    const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function update(dt: number, t: number) {
    SU.uTime.value = t;
    for (const sp of steam) {
      const u = sp.userData;
      u.t += dt * u.speed;
      if (u.t > 1) { u.t -= 1; u.x = rand(-0.14, 0.14); u.seed = rand(0, 100); }
      const p = u.t;
      sp.position.set(u.x + Math.sin(t * 0.8 + u.seed) * 0.08 * p, COFFEE_Y + 0.05 + p * 0.95, Math.cos(t * 0.6 + u.seed) * 0.06 * p);
      const s = 0.22 + p * 0.65;
      sp.scale.set(s, s, 1);
      sp.material.opacity = Math.sin(Math.PI * p) * 0.22 * smooth(0, 0.15, p);
      sp.material.rotation = u.seed + t * 0.15;
    }
  }

  return {
    renderer, scene, camera, cup, makeTexture, pour, update,
    setSize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    },
    render() { renderer.render(scene, camera); },
    dispose() {
      if (tween) tween.kill();
      owned.forEach((o) => o.dispose());
      renderer.dispose();
    },
  };
}
