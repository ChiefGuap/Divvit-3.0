import type { Metadata } from "next";
import "./styles/colors.css";
import "./styles/typography.css";
import "./styles/layout.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Divvit — your brand on every coffee cup", template: "%s · Divvit" },
  description: "Divvit puts startups on the coffee sleeves of cafés in the neighborhoods they care about.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Loaded by name (not next/font) because the 3D sleeves draw text on <canvas>,
            which only sees real font-family names. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&family=Archivo+Black&family=Bricolage+Grotesque:opsz,wght@12..96,800&family=JetBrains+Mono:wght@600;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
