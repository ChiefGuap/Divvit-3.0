/** The shape the animated Brand Health view renders. Built in page.tsx from
 *  real measurements — every field here is either measured or explicitly null. */
export type BrandHealthAspect = {
  label: string;
  weight: string;
  pts: string;
  score: number | null;   // null = this component was never measured
  note: string;
  barColor: string;
  iconKey: string;
};

export type BrandHealthAction = {
  title: string;
  desc: string;
  impact: string;
  iconKey: string;
  color: string;
  tileBg: string;
};

export type SeriesPoint = { at: string; score: number };

export type BrandHealthView = {
  series: SeriesPoint[];
  score: number | null;
  confidence: string;
  coverage: number | null;
  cohortSize: number | null;
  capturedAt: string | null;
  venue: { id: string; name: string; city: string | null } | null;
  aspects: BrandHealthAspect[];
  actions: BrandHealthAction[];
};
