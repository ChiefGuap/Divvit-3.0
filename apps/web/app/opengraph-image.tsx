import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/* The picture shown when a Divvit link is shared (built once, at build time). */

export const alt = "Divvit: your brand on every coffee cup";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(path.join(process.cwd(), "public/assets/divvit-wordmark-purple.png"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px",
        background: "linear-gradient(150deg, #ffffff 0%, #f4eeff 55%, #e6d9ff 100%)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={282} height={100} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: "#170c33", maxWidth: 940 }}>
            Your brand on every coffee cup in the neighborhoods you care about.
          </div>
          <div style={{ fontSize: 32, color: "#4b29b4" }}>Startups book coffee-sleeve campaigns. Cafés earn from the cups they serve.</div>
        </div>
      </div>
    ),
    size,
  );
}
