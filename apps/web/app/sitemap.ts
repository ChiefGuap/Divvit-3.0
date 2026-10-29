import type { MetadataRoute } from "next";
import { marketplace, site } from "@/lib/urls";

// the public pages; everything behind sign-in stays out
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site("/"), changeFrequency: "weekly", priority: 1 },
    { url: site("/how-it-works"), changeFrequency: "monthly", priority: 0.8 },
    { url: marketplace("/"), changeFrequency: "monthly", priority: 0.7 },
    { url: marketplace("/start/startup"), changeFrequency: "monthly", priority: 0.6 },
    { url: marketplace("/start/cafe"), changeFrequency: "monthly", priority: 0.6 },
    { url: site("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: site("/terms"), changeFrequency: "yearly", priority: 0.2 },
  ];
}
