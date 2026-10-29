/* Divvit marketing background: ambient hue blobs over the page wash
   (Divvit Home.dc.html #divvit-hues). The wash itself is on <body>. */

const BLOBS: React.CSSProperties[] = [
  { top: -90, left: -60, width: 520, height: 520, background: "radial-gradient(closest-side, rgba(140,82,255,0.30), rgba(140,82,255,0))", filter: "blur(30px)" },
  { top: "14vh", right: -120, width: 560, height: 560, background: "radial-gradient(closest-side, rgba(183,166,234,0.26), rgba(183,166,234,0))", filter: "blur(30px)" },
  { top: "78vh", left: "26%", width: 480, height: 480, background: "radial-gradient(closest-side, rgba(183,166,234,0.20), rgba(183,166,234,0))", filter: "blur(34px)" },
  { top: "150vh", left: -140, width: 600, height: 600, background: "radial-gradient(closest-side, rgba(140,82,255,0.20), rgba(140,82,255,0))", filter: "blur(34px)" },
  { top: "225vh", right: -100, width: 520, height: 520, background: "radial-gradient(closest-side, rgba(255,203,120,0.16), rgba(255,203,120,0))", filter: "blur(34px)" },
  { bottom: -120, left: "8%", width: 560, height: 560, background: "radial-gradient(closest-side, rgba(140,82,255,0.18), rgba(140,82,255,0))", filter: "blur(34px)" },
];

export function SiteBackground() {
  return (
    <div id="divvit-hues" aria-hidden="true">
      {BLOBS.map((style, i) => <div key={i} style={style} />)}
    </div>
  );
}
