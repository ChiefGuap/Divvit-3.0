import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { activityEvents } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Divvit — Restaurant Dashboard",
  description: "Customer-generated video for restaurants.",
};

// The layout fetches the activity strip so every page shares one read rather
// than each fetching its own.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const events = await activityEvents();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Alatsi&display=swap"
        />
      </head>
      <body>
        <Shell events={events}>{children}</Shell>
      </body>
    </html>
  );
}
