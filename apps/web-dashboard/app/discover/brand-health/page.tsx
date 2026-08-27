/* Organic Brand Health — server component.
 *
 * Fetches the cafe's latest measured snapshot and turns it into the view's
 * shape. Nothing here invents a number: a component the pipeline never
 * measured arrives as `status: "absent"` and is rendered with a null score,
 * not a zero, because a cafe with no review signal is unmeasured rather than
 * badly reviewed. */
import { COMPONENT_LABELS, COMPONENT_ORDER, leadVenue, type ComponentKey } from "@/lib/queries";
import type { BrandHealthAction, BrandHealthAspect, BrandHealthView } from "./types";
import View from "./view";

export const dynamic = "force-dynamic";

/** Plain-language note for one component, phrased from what was measured. */
function noteFor(key: ComponentKey, raw: number | null, absent: boolean): string {
  if (absent || raw === null) {
    if (key === "review_signal") return "No review source matched this venue yet";
    if (key === "engagement_quality") return "Views found, but no likes or comments to rate";
    return "Not measured yet";
  }
  switch (key) {
    case "social_volume":
      return `${raw} video${raw === 1 ? "" : "s"} found about this venue`;
    case "engagement_quality":
      return `${(raw * 100).toFixed(1)}% of viewers liked or commented`;
    case "recency":
      return raw > 0.5 ? "Posted about within the last month" : "Newest video is a while ago";
    case "review_signal":
      return "Rating weighted by how many people left one";
  }
}

/** Recommendations derived from the weakest measured component — not a
 *  hardcoded list. A component we never measured cannot be "weak", so absent
 *  ones are excluded rather than reported as the problem. */
function actionsFrom(aspects: BrandHealthAspect[]): BrandHealthAction[] {
  const measured = aspects.filter((a) => a.score !== null);
  const weakest = [...measured].sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 2);
  const advice: Record<string, { title: string; desc: string }> = {
    "Organic Video Inflow": {
      title: "Get more guests filming",
      desc: "Fewer videos exist about this venue than most of the county. A campaign asking regulars to post is the fastest lever on this component.",
    },
    "Engagement Quality": {
      title: "Work on what travels, not what gets seen",
      desc: "Videos about this venue get views but comparatively few likes or comments. Formats that ask a question tend to move this.",
    },
    "Content Recency": {
      title: "The trail has gone quiet",
      desc: "The newest video about this venue is old enough to be discounted. Recent posts weigh far more than a large back catalogue.",
    },
    "Review Signal": {
      title: "Ask happy guests to review",
      desc: "Rating and review volume together carry a quarter of the score, and this venue sits below the county median on it.",
    },
  };

  const absent = aspects.filter((a) => a.score === null);
  const out: BrandHealthAction[] = weakest.map((a) => ({
    title: advice[a.label]?.title ?? `Improve ${a.label}`,
    desc: advice[a.label]?.desc ?? "",
    impact: `${a.label} · currently ${a.score?.toFixed(0)}th percentile`,
    iconKey: a.iconKey,
    color: "#f59512",
    tileBg: "rgba(245,149,18,0.15)",
  }));

  for (const a of absent) {
    out.push({
      title: `${a.label} is not measured`,
      desc: "This component has no data behind it, so the score is renormalized over the rest and its confidence is capped. Connecting a source here would sharpen the number.",
      impact: "Unmeasured — not counted against the score",
      iconKey: a.iconKey,
      color: "#8c52ff",
      tileBg: "rgba(140,82,255,0.14)",
    });
  }
  return out;
}

export default async function BrandHealthPage() {
  const venue = await leadVenue();
  const snap = venue?.snapshot ?? null;

  const aspects: BrandHealthAspect[] = COMPONENT_ORDER.map((key) => {
    const c = snap?.components?.[key];
    const meta = COMPONENT_LABELS[key];
    const absent = !c || c.status === "absent" || c.percentile === undefined;
    const percentile = absent ? null : (c!.percentile as number);
    const weight = c?.weight ?? 0;
    return {
      label: meta.label,
      weight: `${Math.round(weight * 100)}%`,
      pts: percentile === null ? "—" : (percentile * weight).toFixed(1),
      score: percentile,
      note: noteFor(key, c?.raw ?? null, absent),
      barColor: meta.barColor,
      iconKey: meta.iconKey,
    };
  });

  const data: BrandHealthView = {
    score: snap?.score ?? null,
    confidence: snap?.confidence ?? "none",
    coverage: snap?.coverage ?? null,
    cohortSize: snap?.cohort_size ?? null,
    capturedAt: snap?.captured_at ?? null,
    venue: venue ? { id: venue.id, name: venue.name, city: venue.city } : null,
    aspects,
    actions: actionsFrom(aspects),
  };

  if (!venue || !snap) {
    return (
      <div style={{ padding: 40, maxWidth: 640 }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Organic Brand Health</h1>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
          No measured venue yet. Run the roster and metrics passes
          (<code>services.venues.cli roster</code> then <code>metrics</code>),
          then seed the dashboard. This screen deliberately shows nothing rather
          than a placeholder score.
        </p>
      </div>
    );
  }

  return <View data={data} />;
}
