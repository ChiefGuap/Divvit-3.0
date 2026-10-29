/* Who drinks coffee where: a short audience profile for each neighborhood in
   the network, and a matcher that ranks neighborhoods for a startup from its
   description and category. The matcher runs on its own and also grounds the
   AI suggestions (/api/suggest-areas), which pick from these same profiles. */

export const TAGS = {
  tech: "tech workers", startups: "startup teams", finance: "finance pros", office: "office commuters",
  students: "students", academics: "researchers", families: "families", youngpros: "young professionals",
  creatives: "creatives", design: "designers", fitness: "fitness crowds", health: "health-minded locals",
  foodies: "food lovers", shoppers: "shoppers", tourists: "visitors", nightlife: "night owls", locals: "locals", biotech: "biotech labs",
} as const;
export type Tag = keyof typeof TAGS;

type Profile = { tags: Tag[]; blurb: string };

/** keyed "City|Neighborhood", matching mp_cafes.city / neighborhood */
export const PROFILES: Record<string, Profile> = {
  "Austin|Zilker": { tags: ["fitness", "families", "youngpros"], blurb: "Parks, trails and weekend crowds" },
  "Austin|Mueller": { tags: ["families", "youngpros", "health"], blurb: "Young families in new homes" },
  "Austin|Downtown": { tags: ["office", "finance", "tech", "tourists"], blurb: "Office towers and the Capitol crowd" },
  "Austin|East Austin": { tags: ["creatives", "startups", "nightlife", "youngpros"], blurb: "Studios, startups and late nights" },
  "Austin|Hyde Park": { tags: ["students", "academics"], blurb: "Next to UT Austin" },
  "Austin|South Congress": { tags: ["shoppers", "tourists", "creatives"], blurb: "Boutiques, music and visitors" },
  "Boston|Davis Square": { tags: ["students", "youngpros", "creatives"], blurb: "Tufts students and young renters" },
  "Boston|South End": { tags: ["youngpros", "foodies", "fitness"], blurb: "Restaurants, gyms and brownstones" },
  "Boston|Back Bay": { tags: ["finance", "office", "shoppers"], blurb: "Offices, shopping and commuters" },
  "Boston|Kendall Square": { tags: ["tech", "biotech", "startups", "academics"], blurb: "MIT, biotech labs and startups" },
  "Chicago|West Loop": { tags: ["tech", "startups", "office", "foodies"], blurb: "Tech offices and restaurant row" },
  "Chicago|Logan Square": { tags: ["creatives", "youngpros"], blurb: "Creatives and young renters" },
  "Chicago|Lincoln Park": { tags: ["students", "families", "fitness", "youngpros"], blurb: "DePaul, joggers and young families" },
  "Chicago|Wicker Park": { tags: ["creatives", "nightlife", "shoppers"], blurb: "Shops, bars and artists" },
  "Los Angeles|Echo Park": { tags: ["creatives", "youngpros"], blurb: "Musicians, creators and young renters" },
  "Los Angeles|Silver Lake": { tags: ["creatives", "design", "youngpros"], blurb: "Designers and creators" },
  "Los Angeles|Venice": { tags: ["tech", "startups", "fitness", "creatives", "tourists"], blurb: "Silicon Beach, surfers and creators" },
  "Los Angeles|Arts District": { tags: ["creatives", "design", "startups"], blurb: "Studios, galleries and loft startups" },
  "Miami|Wynwood": { tags: ["creatives", "startups", "tourists", "nightlife"], blurb: "Murals, galleries and new startups" },
  "Miami|Brickell": { tags: ["finance", "office", "youngpros"], blurb: "Miami's finance district" },
  "Miami|Little Havana": { tags: ["locals", "families", "tourists"], blurb: "Locals, culture and visitors" },
  "Miami|Coconut Grove": { tags: ["families", "fitness", "youngpros"], blurb: "Families, parks and the waterfront" },
  "New York|DUMBO": { tags: ["tech", "startups", "creatives"], blurb: "Startup offices and creative agencies" },
  "New York|Flatiron": { tags: ["tech", "office", "youngpros", "startups"], blurb: "Silicon Alley offices" },
  "New York|Greenpoint": { tags: ["creatives", "youngpros"], blurb: "Creatives and young renters" },
  "New York|West Village": { tags: ["students", "youngpros", "shoppers"], blurb: "NYU students and young professionals" },
  "New York|Lower East Side": { tags: ["nightlife", "creatives", "youngpros"], blurb: "Nightlife, galleries and young renters" },
  "New York|Park Slope": { tags: ["families", "locals", "health"], blurb: "Young families and parents" },
  "New York|Williamsburg": { tags: ["creatives", "youngpros", "nightlife", "startups"], blurb: "Creators, makers and young professionals" },
  "Portland|Hawthorne": { tags: ["creatives", "locals", "students"], blurb: "Vintage shops and locals" },
  "Portland|Pearl District": { tags: ["youngpros", "office", "design"], blurb: "Lofts, design firms and offices" },
  "Portland|Alberta Arts": { tags: ["creatives", "locals"], blurb: "Galleries and local makers" },
  "Portland|Division": { tags: ["foodies", "youngpros"], blurb: "Food carts and young renters" },
  "San Francisco|Mission": { tags: ["creatives", "startups", "youngpros", "nightlife"], blurb: "Startups, creatives and late nights" },
  "San Francisco|Hayes Valley": { tags: ["youngpros", "design", "shoppers"], blurb: "Design shops and young professionals" },
  "San Francisco|Dogpatch": { tags: ["startups", "creatives", "design"], blurb: "Makers, small startups and studios" },
  "San Francisco|SoMa": { tags: ["tech", "startups", "office"], blurb: "Tech HQs and startup offices" },
  "San Francisco|Inner Sunset": { tags: ["students", "health", "families", "biotech"], blurb: "UCSF, med students and families" },
  "San Francisco|North Beach": { tags: ["tourists", "locals", "finance"], blurb: "Visitors and Financial District spillover" },
  "Seattle|Fremont": { tags: ["tech", "creatives"], blurb: "Tech offices and creatives" },
  "Seattle|Ballard": { tags: ["families", "youngpros", "locals"], blurb: "Breweries, young families and locals" },
  "Seattle|Pioneer Square": { tags: ["startups", "office", "tech"], blurb: "Startup offices and downtown workers" },
  "Seattle|Capitol Hill": { tags: ["students", "nightlife", "creatives"], blurb: "Students, nightlife and creatives" },
};

const CATEGORY: Record<string, Partial<Record<Tag, number>>> = {
  tech: { tech: 3, startups: 3, youngpros: 1.5, students: 1, office: 1 },
  fintech: { finance: 3, startups: 2, tech: 2, youngpros: 1.5, office: 1 },
  health: { fitness: 3, health: 3, families: 1.5, youngpros: 1, biotech: 1 },
  consumer: { youngpros: 2, shoppers: 2, creatives: 1.5, students: 1 },
  food_bev: { foodies: 3, locals: 1.5, families: 1, tourists: 1 },
  climate: { creatives: 1.5, youngpros: 1.5, students: 1.5, families: 1, fitness: 1 },
  education: { students: 3, academics: 2, families: 2 },
  nonprofit: { locals: 2, families: 1.5, students: 1.5, creatives: 1 },
  local: { locals: 3, families: 1.5, foodies: 1 },
  crypto: { tech: 2, finance: 2, startups: 2, nightlife: 0.5 },
};

const KEYWORDS: [RegExp, Partial<Record<Tag, number>>][] = [
  [/student|college|campus|universit|tutor|exam|study/, { students: 2.5, academics: 1 }],
  [/parent|kid|famil|baby|child|toddler/, { families: 2.5 }],
  [/developer|engineer|\bcode|devops|\bapi\b|saas|b2b|software|\bai\b|data/, { tech: 2, startups: 1 }],
  [/founder|startup|\bvc\b|investor|fundrais/, { startups: 2 }],
  [/bank|financ|invest|payment|payroll|expense|trading|accounting|tax/, { finance: 2 }],
  [/design|creator|artist|music|photo|video|content|creative/, { creatives: 2, design: 1 }],
  [/fitness|gym|workout|running|yoga|sleep|wellness|health|nutrition/, { fitness: 2, health: 1.5 }],
  [/food|restaurant|snack|drink|meal|grocer|coffee|beer|recipe/, { foodies: 2 }],
  [/shop|fashion|beauty|retail|e-?commerce|apparel|clothing|skincare/, { shoppers: 2 }],
  [/remote|meeting|notes|productivity|team|workplace|calendar|hiring|recruit/, { youngpros: 1.5, office: 1.5 }],
  [/travel|tourist|visitor|hotel/, { tourists: 2 }],
  [/\blab|research|biotech|science|clinic|doctor|medical|patient/, { biotech: 2, academics: 1 }],
  [/nightlife|\bbar\b|event|party|dating|concert/, { nightlife: 1.5 }],
];

export type Hood = { city: string; neighborhood: string; cafes: number };
export type Suggestion = { id: string; city: string; neighborhood: string; audience: string; reason: string; cafes: number };

export const hoodId = (city: string, neighborhood: string) => `${city}|${neighborhood}`;
export const profileOf = (city: string, neighborhood: string | null) => (neighborhood ? PROFILES[hoodId(city, neighborhood)] : undefined);
export const audienceLabel = (tags: Tag[], n = 3) => tags.slice(0, n).map((t) => TAGS[t]).map((s, i) => (i ? s : s[0].toUpperCase() + s.slice(1))).join(" · ");

/** Rank the network's neighborhoods for a startup; at most two per city so the list isn't one city. */
export function matchAreas(input: { description: string; category: string; hq?: string | null }, hoods: Hood[], limit = 5): Suggestion[] {
  // when the description names an audience, it leads and the broad category only nudges
  const text = input.description.toLowerCase();
  const hits = KEYWORDS.filter(([re]) => re.test(text));
  const base = CATEGORY[input.category] ?? CATEGORY.tech, scale = hits.length ? 0.4 : 1;
  const want: Partial<Record<Tag, number>> = Object.fromEntries(Object.entries(base).map(([t, w]) => [t, w! * scale]));
  for (const [, add] of hits) for (const [t, w] of Object.entries(add)) want[t as Tag] = (want[t as Tag] ?? 0) + w! * 2.5;
  const home = (input.hq ?? "").toLowerCase();

  const scored = hoods.flatMap((h) => {
    const p = PROFILES[hoodId(h.city, h.neighborhood)];
    if (!p) return [];
    const fits = p.tags.filter((t) => want[t]).sort((a, b) => want[b]! - want[a]!);
    const score = fits.reduce((s, t) => s + want[t]!, 0) + Math.log1p(h.cafes) * 0.3 + (home && home.includes(h.city.toLowerCase()) ? 1 : 0);
    return fits.length ? [{ h, p, fits, score }] : [];
  }).sort((a, b) => b.score - a.score);

  const perCity: Record<string, number> = {};
  const out: Suggestion[] = [];
  for (const { h, p, fits } of scored) {
    if ((perCity[h.city] ?? 0) >= 2) continue;
    perCity[h.city] = (perCity[h.city] ?? 0) + 1;
    out.push({ id: hoodId(h.city, h.neighborhood), city: h.city, neighborhood: h.neighborhood, cafes: h.cafes, audience: audienceLabel(fits), reason: p.blurb });
    if (out.length >= limit) break;
  }
  return out;
}
