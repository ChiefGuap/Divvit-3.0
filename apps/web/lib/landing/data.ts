/* Landing-page showcase: one sleeve campaign per startup.
   Numbers are placeholders — swap in real campaign results. What each card shows:
     weeks / dates   → Campaign duration (one bar segment per week)
     cafes / city    → Café placements (one dot per café)
     weeklySleeves   → Cup sleeves placed (total = sum, sparkline = cumulative)
     engagements     → Engagements (total = sum of breakdown, rate = ÷ sleeves) */

import type { SleeveFont } from "@/lib/cup/textures";

export type ShowcaseStartup = {
  name: string;
  tagline: string;
  sector: string;
  accent: string;
  font: SleeveFont;
  sleeve: { base: string; ink: string };
  campaign: {
    weeks: number;
    dates: string;
    city: string;
    cafes: number;
    weeklySleeves: number[];
    engagements: [string, number][];
  };
};

export const SHOWCASE: ShowcaseStartup[] = [
  {
    name: "Lumen", tagline: "AI meeting notes that write themselves", sector: "Productivity",
    accent: "#ffb36b", font: { family: "Instrument Serif", weight: "400", style: "italic" },
    sleeve: { base: "#b9895b", ink: "#2a170c" },
    campaign: {
      weeks: 6, dates: "Mar 2 – Apr 12, 2026", city: "Austin, TX", cafes: 42,
      weeklySleeves: [2100, 2900, 3300, 3400, 3500, 3300],
      engagements: [["QR scans", 1980], ["Promo codes", 820], ["Social posts", 440]],
    },
  },
  {
    name: "Orbit Pay", tagline: "Cross-border payouts that land in seconds", sector: "Fintech",
    accent: "#c6ff3d", font: { family: "Archivo Black", weight: "400", style: "normal" },
    sleeve: { base: "#1c1c1e", ink: "#c6ff3d" },
    campaign: {
      weeks: 4, dates: "Jan 12 – Feb 8, 2026", city: "Miami, FL", cafes: 28,
      weeklySleeves: [2400, 3100, 3300, 3200],
      engagements: [["QR scans", 1310], ["Promo codes", 560], ["Social posts", 290]],
    },
  },
  {
    name: "Fernhouse", tagline: "Rare houseplants, delivered alive", sector: "Commerce",
    accent: "#8fd19e", font: { family: "Bricolage Grotesque", weight: "800", style: "normal" },
    sleeve: { base: "#a7b597", ink: "#183324" },
    campaign: {
      weeks: 8, dates: "Apr 6 – May 31, 2026", city: "Portland, OR", cafes: 64,
      weeklySleeves: [3000, 3600, 4100, 4300, 4400, 4500, 4600, 4500],
      engagements: [["QR scans", 3850], ["Promo codes", 2100], ["Social posts", 980]],
    },
  },
  {
    name: "Kilnworks", tagline: "CI pipelines that never flake", sector: "Dev tools",
    accent: "#ff7a59", font: { family: "JetBrains Mono", weight: "800", style: "normal" },
    sleeve: { base: "#efe5d3", ink: "#c93c25" },
    campaign: {
      weeks: 3, dates: "May 4 – May 24, 2026", city: "San Francisco, CA", cafes: 18,
      weeklySleeves: [2200, 2700, 3100],
      engagements: [["QR scans", 760], ["Promo codes", 210], ["Social posts", 150]],
    },
  },
  {
    name: "Tidal Health", tagline: "Sleep coaching backed by clinicians", sector: "Health",
    accent: "#7cc4ff", font: { family: "Inter", weight: "800", style: "normal" },
    sleeve: { base: "#1e2d4b", ink: "#e8eef8" },
    campaign: {
      weeks: 10, dates: "Jun 1 – Aug 9, 2026", city: "Brooklyn, NY", cafes: 85,
      weeklySleeves: [3200, 4100, 4600, 4900, 5100, 5200, 5300, 5400, 5600, 5600],
      engagements: [["QR scans", 5120], ["Promo codes", 2790], ["Social posts", 1400]],
    },
  },
];
