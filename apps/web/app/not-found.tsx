import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

/* Both hosts share this page: "/" is the landing page on divvit.app and the
   welcome screen on marketplace.divvit.app, so one link works for either. */

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "48px 20px", fontFamily: "Outfit, Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <img src="/assets/divvit-wordmark-purple.png" alt="Divvit" style={{ height: 30, marginBottom: 18 }} />
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>This page isn&apos;t on the menu</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#6b7280" }}>The link may be old, or the address has a typo.</p>
        <Link href="/" className="divvit-plainsm" style={{ marginTop: 10, padding: "12px 22px", borderRadius: 999, color: "#fff", fontWeight: 600, textDecoration: "none" }}>
          <span>Back to Divvit</span>
        </Link>
      </div>
    </main>
  );
}
