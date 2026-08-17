/* Fixture data lifted from the design prototype.
   Every export here stands in for a real API response — see BACKEND.md in the
   handoff for the endpoint each one maps to. Swap these for fetches without
   touching the components. */

export const RESTAURANT = { name: "Divvit Cafe", plan: "Pro plan", user: "Elliott", initials: "EL" };

const up = (f: string) => `url('/uploads/${f}') center 50%/135% no-repeat`;
export const thumb = (f: string, grad: string) => `${up(f)}, ${grad}`;

/* ---- GET /overview : inflow buckets (7 days x 3 sampled hours) ---- */
export const inflowByDay = [
  { day: "Sat", bars: [{ hour: "9a", n: 2 }, { hour: "12p", n: 6 }, { hour: "3p", n: 4 }] },
  { day: "Sun", bars: [{ hour: "9a", n: 3 }, { hour: "12p", n: 7 }, { hour: "3p", n: 5 }] },
  { day: "Mon", bars: [{ hour: "9a", n: 1 }, { hour: "12p", n: 3 }, { hour: "3p", n: 2 }] },
  { day: "Tue", bars: [{ hour: "9a", n: 1 }, { hour: "12p", n: 4 }, { hour: "3p", n: 2 }] },
  { day: "Wed", bars: [{ hour: "9a", n: 2 }, { hour: "12p", n: 4 }, { hour: "3p", n: 3 }] },
  { day: "Thu", bars: [{ hour: "9a", n: 2 }, { hour: "12p", n: 5 }, { hour: "3p", n: 3 }] },
  { day: "Fri", bars: [{ hour: "9a", n: 2 }, { hour: "12p", n: 7 }, { hour: "3p", n: 5 }] },
];

/* ---- GET /overview : views on posted content, Divvit-sourced vs their own ---- */
export const attention7d = [
  { day: "Sat", divvit: 9200, organic: 3100, top: [
    { title: "Patio brunch spread", src: "Divvit", views: "5.1K" },
    { title: "Saturday special (our post)", src: "Yours", views: "2.4K" }] },
  { day: "Sun", divvit: 7400, organic: 2600, top: [
    { title: "Latte art, slow pour", src: "Divvit", views: "4.3K" },
    { title: "Sunday hours (our post)", src: "Yours", views: "1.8K" }] },
  { day: "Mon", divvit: 4100, organic: 1900, top: [
    { title: "Burrata toast close-up", src: "Divvit", views: "2.6K" },
    { title: "Staff pick of the week", src: "Yours", views: "1.2K" }] },
  { day: "Tue", divvit: 5300, organic: 2200, top: [
    { title: "Espresso martini pour", src: "Divvit", views: "3.4K" },
    { title: "Tuesday pasta night", src: "Yours", views: "1.5K" }] },
  { day: "Wed", divvit: 6800, organic: 2400, top: [
    { title: "Dining room, golden hour", src: "Divvit", views: "4.0K" },
    { title: "Meet the chef (our post)", src: "Yours", views: "1.6K" }] },
  { day: "Thu", divvit: 10400, organic: 2900, top: [
    { title: "Amir Khan — first bite", src: "Divvit", views: "6.8K" },
    { title: "Wine pairing night recap", src: "Divvit", views: "2.4K" },
    { title: "Thursday menu (our post)", src: "Yours", views: "1.9K" }] },
  { day: "Fri", divvit: 14600, organic: 3400, top: [
    { title: "Barista latte pour, slow-mo", src: "Divvit", views: "9.2K" },
    { title: "Interior tour, night", src: "Divvit", views: "3.6K" },
    { title: "Live jazz tonight (our post)", src: "Yours", views: "2.2K" }] },
];

/* ---- GET /overview : home submission carousel ---- */
export const homeSubmissions = [
  { creator: "Maya Sørensen", meta: "Uploaded via Divvit · today", length: "0:34", source: "Submitted", srcBg: "rgba(140,82,255,0.9)", thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { creator: "Jordan Tran", meta: "Uploaded via Divvit · today", length: "0:21", source: "Submitted", srcBg: "rgba(140,82,255,0.9)", thumbBg: thumb("IMG_8213.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)") },
  { creator: "@eatswithamir", meta: "14.3K views · found on TikTok", length: "0:48", source: "Discovered", srcBg: "rgba(17,24,39,0.75)", thumbBg: thumb("IMG_8214.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { creator: "Lucia Reyes", meta: "Uploaded via Divvit · yesterday", length: "0:27", source: "Submitted", srcBg: "rgba(140,82,255,0.9)", thumbBg: thumb("IMG_8215.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
  { creator: "Devon Park", meta: "Uploaded via Divvit · yesterday", length: "0:39", source: "Submitted", srcBg: "rgba(140,82,255,0.9)", thumbBg: thumb("IMG_8216.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)") },
  { creator: "@sfbrunchclub", meta: "6.7K views · found on Instagram", length: "0:52", source: "Discovered", srcBg: "rgba(17,24,39,0.75)", thumbBg: thumb("IMG_8217.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)") },
  { creator: "Priya Nair", meta: "Uploaded via Divvit · 2 days ago", length: "0:24", source: "Submitted", srcBg: "rgba(140,82,255,0.9)", thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)") },
  { creator: "@noahtastes", meta: "3.2K views · found on TikTok", length: "0:31", source: "Discovered", srcBg: "rgba(17,24,39,0.75)", thumbBg: thumb("IMG_8220.jpg", "linear-gradient(135deg, #ffe3a1, #f59512)") },
];

/* ---- WS /activity/stream : only clip_submitted | reward_redeemed ---- */
export const feedPool = [
  { who: "Jordan Tran", what: "sent a new clip", meta: "0:22 · dinner service", icon: "clapper" as const, fg: "#8c52ff", clip: true },
  { who: "Amir Khan", what: "redeemed Free dessert", meta: "250 pts · Rewards", icon: "gift" as const, fg: "#f59512", clip: false },
  { who: "Priya Nair", what: "sent a new clip", meta: "0:15 · dessert plating", icon: "clapper" as const, fg: "#8c52ff", clip: true },
  { who: "Devon Park", what: "redeemed 15% off next visit", meta: "400 pts · Rewards", icon: "gift" as const, fg: "#f59512", clip: false },
  { who: "Hana Cho", what: "sent a new clip", meta: "0:31 · the room", icon: "clapper" as const, fg: "#8c52ff", clip: true },
  { who: "Lucia Reyes", what: "redeemed 250 bonus points", meta: "Rewards", icon: "gift" as const, fg: "#f59512", clip: false },
  { who: "Marcus Bell", what: "sent a new clip", meta: "0:18 · truffle pasta", icon: "clapper" as const, fg: "#8c52ff", clip: true },
  { who: "Ava Chen", what: "redeemed Chef's tasting for two", meta: "1,500 pts · Rewards", icon: "gift" as const, fg: "#f59512", clip: false },
  { who: "Noah Kim", what: "sent a new clip", meta: "0:27 · bar at night", icon: "clapper" as const, fg: "#8c52ff", clip: true },
  { who: "Zoe Adams", what: "redeemed Free main", meta: "600 pts · Rewards", icon: "gift" as const, fg: "#f59512", clip: false },
];

export const searchPhrases = [
  "Search for incoming clips", "Creators leaderboard", "Track metrics",
  "Modify rewards", "Create a trendy video",
];

/* ---- GET /submissions : The Collection triage grid ---- */
export type MktVideo = {
  id: string; creator: string; handle: string; source: "TikTok" | "Instagram" | "upload";
  type: "review" | "item" | "interior" | "event" | "vlog";
  tier: "leaderboard" | "regular" | "first";
  daysAgo: number; length: string; views: string; likes: string; fileSize: string;
  thumbBg: string; context: string;
};

export const mktVideos: MktVideo[] = [
  { id: "m1", creator: "Sofia Marín", handle: "@sofiaeats", source: "TikTok", type: "review", tier: "leaderboard", daysAgo: 0, length: "0:41", views: "12.4K", likes: "1.8K", fileSize: "", thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)"), context: "Walks through her whole tasting-menu night and calls the pasta “the best in the city.”" },
  { id: "m2", creator: "Marcus Bell", handle: "Divvit user", source: "upload", type: "item", tier: "first", daysAgo: 0, length: "0:18", views: "—", likes: "—", fileSize: "52 MB", thumbBg: thumb("IMG_8173.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)"), context: "Close-up slow-mo of the truffle pasta being plated. Clean, well-lit, ready to repost." },
  { id: "m3", creator: "Ava Chen", handle: "@avaandforks", source: "Instagram", type: "review", tier: "regular", daysAgo: 0, length: "0:36", views: "8.1K", likes: "940", fileSize: "", thumbBg: thumb("IMG_8186.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)"), context: "Quick honest review — raves about the burrata and the patio service." },
  { id: "m4", creator: "Diego Ramos", handle: "Divvit user", source: "upload", type: "interior", tier: "regular", daysAgo: 0, length: "0:23", views: "—", likes: "—", fileSize: "44 MB", thumbBg: thumb("IMG_8189.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"), context: "Golden-hour pan across the dining room and open kitchen. Great for a vibe reel." },
  { id: "m5", creator: "Nina Osei", handle: "@ninatries", source: "TikTok", type: "review", tier: "first", daysAgo: 0, length: "0:38", views: "4.6K", likes: "610", fileSize: "", thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)"), context: "First-visit review — loved the burrata, wants a bigger dessert menu." },
  { id: "m6", creator: "Liam Foster", handle: "Divvit user", source: "upload", type: "item", tier: "leaderboard", daysAgo: 0, length: "0:15", views: "—", likes: "—", fileSize: "39 MB", thumbBg: thumb("IMG_8210.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)"), context: "Crisp shot of the espresso martini pour. Short, loopable, perfect for stories." },
  { id: "m7", creator: "Priya Kohli", handle: "@priyaplates", source: "Instagram", type: "event", tier: "regular", daysAgo: 0, length: "1:04", views: "6.9K", likes: "820", fileSize: "", thumbBg: thumb("IMG_8211.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)"), context: "Covers your wine-pairing night with the chef intro and a full table spread." },
  { id: "m8", creator: "Owen Barrett", handle: "Divvit user", source: "upload", type: "vlog", tier: "first", daysAgo: 0, length: "0:47", views: "—", likes: "—", fileSize: "71 MB", thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #ffe3a1, #f59512)"), context: "Birthday-dinner vlog with friends. Candid, upbeat, lots of happy reactions." },
  { id: "m9", creator: "Camila Rossi", handle: "@camilabites", source: "TikTok", type: "interior", tier: "leaderboard", daysAgo: 0, length: "0:29", views: "15.2K", likes: "2.3K", fileSize: "", thumbBg: thumb("IMG_8213.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)"), context: "Aesthetic interior tour that already hit 15K views on her page." },
  { id: "m10", creator: "Theo Vance", handle: "Divvit user", source: "upload", type: "review", tier: "regular", daysAgo: 0, length: "0:33", views: "—", likes: "—", fileSize: "48 MB", thumbBg: thumb("IMG_8214.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"), context: "Talking-head review shot at the table. Genuine and detailed on the service." },
  { id: "m11", creator: "Hana Suzuki", handle: "@hanaeats", source: "Instagram", type: "vlog", tier: "regular", daysAgo: 0, length: "0:52", views: "9.4K", likes: "1.1K", fileSize: "", thumbBg: thumb("IMG_8215.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)"), context: "Weekend-brunch vlog that lingers on the pancakes and the latte art." },
  { id: "m12", creator: "Grace Miller", handle: "Divvit user", source: "upload", type: "item", tier: "first", daysAgo: 0, length: "0:16", views: "—", likes: "—", fileSize: "35 MB", thumbBg: thumb("IMG_8216.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)"), context: "Overhead shot of the burrata toast. Bright, simple, repost-ready." },
  { id: "m13", creator: "Andre Silva", handle: "@andrebites", source: "TikTok", type: "review", tier: "leaderboard", daysAgo: 0, length: "0:44", views: "22.7K", likes: "3.1K", fileSize: "", thumbBg: thumb("IMG_8217.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)"), context: "In-depth review that already broke 22K views — huge on the pasta and dessert." },
  { id: "m14", creator: "Noah Kim", handle: "Divvit user", source: "upload", type: "interior", tier: "regular", daysAgo: 0, length: "0:27", views: "—", likes: "—", fileSize: "58 MB", thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)"), context: "Slow walk-through of the bar and lounge at night. Moody, great B-roll." },
  { id: "m15", creator: "Zoe Adams", handle: "@zoedines", source: "Instagram", type: "event", tier: "first", daysAgo: 0, length: "0:58", views: "3.8K", likes: "520", fileSize: "", thumbBg: thumb("IMG_8220.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)"), context: "Captures your live-jazz night — full room, great energy, chef cameo." },
  { id: "m16", creator: "Ravi Patel", handle: "@ravitastes", source: "TikTok", type: "item", tier: "regular", daysAgo: 0, length: "0:19", views: "7.2K", likes: "880", fileSize: "", thumbBg: thumb("IMG_8221.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)"), context: "Tight food montage of the tasting menu, each dish named on screen." },
  { id: "m17", creator: "Emma Wright", handle: "Divvit user", source: "upload", type: "vlog", tier: "leaderboard", daysAgo: 0, length: "0:49", views: "—", likes: "—", fileSize: "66 MB", thumbBg: thumb("IMG_8222.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"), context: "Anniversary-dinner vlog. Warm, personal, lots of happy table moments." },
  { id: "m18", creator: "Lucas Moreau", handle: "Divvit user", source: "upload", type: "event", tier: "regular", daysAgo: 0, length: "1:02", views: "—", likes: "—", fileSize: "80 MB", thumbBg: thumb("IMG_8223.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)"), context: "Private-party recap filmed across the evening. Good for a highlights cut." },
  { id: "m19", creator: "Isla Fraser", handle: "@islaeats", source: "Instagram", type: "review", tier: "regular", daysAgo: 1, length: "0:35", views: "5.5K", likes: "690", fileSize: "", thumbBg: thumb("IMG_8210.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)"), context: "Short, glowing review of the patio and the espresso martini." },
  { id: "m20", creator: "Ben Carter", handle: "Divvit user", source: "upload", type: "item", tier: "first", daysAgo: 2, length: "0:17", views: "—", likes: "—", fileSize: "41 MB", thumbBg: thumb("IMG_8211.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)"), context: "Macro shot of the dessert plating. Clean lighting, repost-ready." },
  { id: "m21", creator: "Yuki Tanaka", handle: "@yukitours", source: "TikTok", type: "interior", tier: "leaderboard", daysAgo: 3, length: "0:31", views: "18.1K", likes: "2.6K", fileSize: "", thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)"), context: "Viral interior tour of the dining room — 18K views and climbing." },
  { id: "m22", creator: "Sara Lopez", handle: "@saradines", source: "Instagram", type: "event", tier: "regular", daysAgo: 5, length: "0:54", views: "6.2K", likes: "740", fileSize: "", thumbBg: thumb("IMG_8213.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)"), context: "Recap of your tasting-menu night with the full room and chef intro." },
  { id: "m23", creator: "Max Bauer", handle: "Divvit user", source: "upload", type: "vlog", tier: "first", daysAgo: 8, length: "0:46", views: "—", likes: "—", fileSize: "69 MB", thumbBg: thumb("IMG_8214.jpg", "linear-gradient(135deg, #ffe3a1, #f59512)"), context: "Friends' night-out vlog. Fun, candid, plenty of reaction shots." },
  { id: "m24", creator: "Dan Cole", handle: "Divvit user", source: "upload", type: "review", tier: "regular", daysAgo: 18, length: "0:32", views: "—", likes: "—", fileSize: "47 MB", thumbBg: thumb("IMG_8215.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"), context: "Detailed talking-head review filmed at the table. Genuine and thorough." },
];

/* highlights[] on Submission — 2-3 bullets describing the clip */
export const mktBullets: Record<string, string[]> = {
  m1: ["Full tasting-menu walkthrough", "Calls the pasta best in the city", "12.4K views already"],
  m2: ["Slow-mo truffle pasta plating", "Clean, well-lit close-up", "Repost-ready as-is"],
  m3: ["Quick honest review", "Raves about the burrata", "Praises the patio service"],
  m4: ["Golden-hour dining room pan", "Open kitchen in frame", "Good B-roll for a vibe reel"],
  m5: ["First-visit reaction", "Loved the burrata", "Asks for a bigger dessert menu"],
  m6: ["Espresso martini pour", "Short and loopable", "Fits a story slot"],
  m7: ["Wine-pairing night coverage", "Chef intro on camera", "Full table spread"],
  m8: ["Birthday dinner with friends", "Candid, upbeat energy", "Lots of happy reactions"],
  m9: ["Aesthetic interior tour", "Already at 15.2K views", "Strong opening hook"],
  m10: ["Talking-head at the table", "Detailed on the service", "Genuine and unscripted"],
  m11: ["Weekend brunch vlog", "Lingers on the pancakes", "Latte art close-up"],
  m12: ["Overhead burrata toast", "Bright, simple framing", "Repost-ready"],
  m13: ["In-depth review", "22.7K views and climbing", "Big on pasta and dessert"],
  m14: ["Night walk-through of the bar", "Moody lighting", "Great B-roll"],
  m15: ["Live-jazz night", "Full room, high energy", "Chef cameo"],
  m16: ["Tight tasting-menu montage", "Each dish named on screen", "Fast cut"],
  m17: ["Anniversary dinner vlog", "Warm and personal", "Happy table moments"],
  m18: ["Private-party recap", "Filmed across the evening", "Good for a highlights cut"],
  m19: ["Short, glowing review", "Patio gets the spotlight", "Espresso martini featured"],
  m20: ["Macro dessert plating", "Clean lighting", "Repost-ready"],
  m21: ["Viral dining-room tour", "18.1K views", "Strong first three seconds"],
  m22: ["Tasting-menu night recap", "Full room on camera", "Chef intro included"],
  m23: ["Friends' night-out vlog", "Fun and candid", "Plenty of reaction shots"],
  m24: ["Talking-head review", "Thorough and genuine", "Filmed at the table"],
};

/* Submission.kind — how the clip arrived */
export const subKinds = {
  general: { label: "General", full: "General submission", reward: "250 points", note: "Any clip from their visit", iconKey: "video", fg: "#8c52ff", bg: "rgba(140,82,255,0.10)" },
  instructions: { label: "Instructions", full: "Filmed to your instructions", reward: "Free dessert + 400 pts", note: "Followed the shot list you posted", iconKey: "book", fg: "#b9700a", bg: "rgba(245,149,18,0.13)" },
  social: { label: "Social media posted", full: "Posted to their own social", reward: "15% off + 600 pts", note: "Published on their own account, then linked it", iconKey: "share", fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)" },
} as const;

export type SubKind = keyof typeof subKinds;

const mktSubMap: Record<string, SubKind> = {
  m2: "instructions", m4: "general", m6: "instructions", m8: "general", m10: "general",
  m12: "instructions", m14: "general", m17: "general", m18: "instructions", m20: "instructions",
};
export const subOf = (v: MktVideo): SubKind =>
  v.source === "upload" ? (mktSubMap[v.id] || "general") : "social";

/* ---- GET /content : Content Manager ---- */
export const cmVideos = [
  { creator: "Amir Khan", meta: "Accepted Jul 15 · linked TikTok post · 14.3K views", thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)"), archivedDays: 12, fileSize: "" },
  { creator: "Maya Sørensen", meta: "Accepted Jul 14 · uploaded via Divvit", thumbBg: thumb("IMG_8173.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)"), archivedDays: 11, fileSize: "84 MB" },
  { creator: "Jordan Tran", meta: "Accepted Jul 12 · uploaded via Divvit", thumbBg: thumb("IMG_8186.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)"), archivedDays: 9, fileSize: "46 MB" },
  { creator: "Lucia Reyes", meta: "Accepted Jul 10 · uploaded via Divvit", thumbBg: thumb("IMG_8189.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"), archivedDays: 8, fileSize: "61 MB" },
  { creator: "Priya Nair", meta: "Accepted Jul 8 · uploaded via Divvit", thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)"), archivedDays: 6, fileSize: "38 MB" },
  { creator: "Devon Park", meta: "Archived Jul 16 · uploaded via Divvit", thumbBg: thumb("IMG_8223.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)"), archivedDays: 12, fileSize: "" },
];

export const cmUsage: Record<string, { n: number; last: string; where: string }> = {
  "Amir Khan": { n: 3, last: "Jul 19", where: "TikTok · Instagram" },
  "Maya Sørensen": { n: 1, last: "Jul 16", where: "Instagram" },
};

export const cmEditorCuts = [
  { id: "ec1", title: "Friday night, fast cut", style: "Local review", posted: "Posted Jul 24 · TikTok + Instagram", clips: 5, views: "24.6K", cpm: "$1.90", thumbBg: thumb("IMG_8222.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { id: "ec2", title: "The room after dark", style: "Simple interior", posted: "Posted Jul 19 · Instagram", clips: 4, views: "11.2K", cpm: "$2.60", thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
  { id: "ec3", title: "Six dishes in thirty seconds", style: "Item highlights", posted: "Posted Jul 11 · TikTok", clips: 6, views: "18.4K", cpm: "$2.10", thumbBg: thumb("IMG_8221.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
];

export const cmTopPerformers = [
  { rank: "1", creator: "@eatswithamir", views: "14.3K", platform: "TikTok", thumbBg: thumb("IMG_8222.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { rank: "2", creator: "Maya Sørensen", views: "5.8K", platform: "your Instagram", thumbBg: thumb("IMG_8223.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { rank: "3", creator: "@sfbrunchclub", views: "4.2K", platform: "Instagram", thumbBg: thumb("IMG_8210.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)") },
  { rank: "4", creator: "Lucia Reyes", views: "2.9K", platform: "your TikTok", thumbBg: thumb("IMG_8211.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
];

/* GET /content/:id/metrics — deterministic stand-in, replace wholesale */
export function cmMetricsFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const k = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n)));
  const views = 3400 + (h % 27) * 950;
  const eng = (4.1 + (h % 46) / 10).toFixed(1) + "%";
  const cpm = (1.8 + (h % 23) / 10).toFixed(2);
  return [
    { label: "VIEWS", value: k(views), note: "since it went up", fg: "#111827" },
    { label: "ENGAGEMENT", value: eng, note: "likes + comments / views", fg: "#8c52ff" },
    { label: "CPM", value: "$" + cpm, note: "vs $7–12 paid", fg: "#16a06b" },
    { label: "SAVES", value: k(Math.round(views * 0.041)), note: "saved for later", fg: "#111827" },
    { label: "SHARES", value: k(Math.round(views * 0.016)), note: "sent to a friend", fg: "#111827" },
  ];
}

/* ---- GET /rewards ---- */
export type Reward = {
  id: string; name: string; sub: SubKind; type: string; cost: number;
  claimed: number; cap: number; live: boolean; iconKey: string;
  fg: string; bg: string; value: number; avgViews: number;
};

export const rewardList: Reward[] = [
  { id: "r1", name: "Free dessert", sub: "general", type: "Menu item", cost: 250, claimed: 38, cap: 50, live: true, iconKey: "gift", fg: "#8c52ff", bg: "rgba(140,82,255,0.12)", value: 9, avgViews: 4200 },
  { id: "r2", name: "250 bonus points", sub: "general", type: "Points", cost: 0, claimed: 96, cap: 120, live: true, iconKey: "sparkle", fg: "#6346cd", bg: "rgba(99,70,205,0.12)", value: 2.5, avgViews: 2600 },
  { id: "r3", name: "Chef's tasting for two", sub: "instructions", type: "Experience", cost: 1500, claimed: 4, cap: 6, live: true, iconKey: "crown", fg: "#f59512", bg: "rgba(245,149,18,0.14)", value: 140, avgViews: 21000 },
  { id: "r4", name: "Free main, shot list followed", sub: "instructions", type: "Menu item", cost: 600, claimed: 11, cap: 20, live: true, iconKey: "book", fg: "#b9700a", bg: "rgba(245,149,18,0.14)", value: 26, avgViews: 9800 },
  { id: "r5", name: "15% off next visit", sub: "social", type: "Discount", cost: 400, claimed: 27, cap: 40, live: true, iconKey: "card", fg: "#16a06b", bg: "rgba(22,160,107,0.12)", value: 7, avgViews: 3400 },
  { id: "r6", name: "Name a special for a week", sub: "social", type: "Experience", cost: 2000, claimed: 1, cap: 2, live: false, iconKey: "store", fg: "#e04f8c", bg: "rgba(224,79,140,0.12)", value: 60, avgViews: 12000 },
];

export const REWARD_PAID_BENCHMARK = 9.5;
export const rewardImage: Record<string, string> = {
  r1: thumb("IMG_8211.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)"),
  r2: thumb("IMG_8194.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)"),
  r3: thumb("IMG_8217.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)"),
  r4: thumb("IMG_8186.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)"),
  r5: thumb("IMG_8189.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)"),
  r6: thumb("IMG_8213.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)"),
};

/* ---- GET /discover ---- */
export const discVideos = [
  { id: "d1", creator: "Sofia Marín", handle: "@sofiaeats", platform: "tiktok", views: "12.4K", likes: "1.8K", posted: "2 days ago", match: "hashtag", matchText: "#divvitcafe", thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { id: "d2", creator: "James Whitlock", handle: "@jameseatsla", platform: "instagram", views: "8.9K", likes: "1.2K", posted: "3 days ago", match: "geotag", matchText: "Divvit Cafe · SF", thumbBg: thumb("IMG_8173.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { id: "d5", creator: "Maya Sørensen", handle: "@mayacooks", platform: "instagram", views: "15.7K", likes: "2.4K", posted: "1 week ago", match: "hashtag", matchText: "#divvitcafe", thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)") },
  { id: "d6", creator: "Nico Ferrari", handle: "@nicoeats", platform: "tiktok", views: "31.5K", likes: "5.2K", posted: "1 week ago", match: "geotag", matchText: "Divvit Cafe · SF", thumbBg: thumb("IMG_8216.jpg", "linear-gradient(135deg, #ffe3a1, #f59512)") },
  { id: "d8", creator: "Priya Nair", handle: "@priyaeats", platform: "instagram", views: "6.3K", likes: "740", posted: "11 days ago", match: "caption", matchText: "“date night at Divvit Cafe 💜”", thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { id: "d9", creator: "Marco Bellini", handle: "@marcobites", platform: "tiktok", views: "9.7K", likes: "1.4K", posted: "12 days ago", match: "hashtag", matchText: "#divvitcafe", thumbBg: thumb("IMG_8220.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
];

/* ---- GET /brand-health ---- */
export const BH_SCORE = 83;

export const bhAspects = [
  { label: "Organic Video Inflow", weight: "35%", pts: "31.9", score: 91, note: "47 videos this month, up 34%", barColor: "#6346cd", iconKey: "video" },
  { label: "Social Media Traction", weight: "30%", pts: "25.2", score: 84, note: "214 mentions · 312K impressions", barColor: "#8c52ff", iconKey: "radar" },
  { label: "Creator Relationship", weight: "25%", pts: "19.5", score: 78, note: "68% of rewards claimed by creators", barColor: "#8c52ff", iconKey: "gift" },
  { label: "Campaign Traction", weight: "10%", pts: "6.5", score: 65, note: "2 of 3 campaigns hitting targets", barColor: "#b79aff", iconKey: "megaphone" },
];

export const bhActions = [
  { title: "Launch a campaign for slow weekdays", desc: "Campaign Traction is your weakest aspect. A targeted Tue–Thu video request could lift claim rates.", impact: "Campaign Traction +6 est.", iconKey: "megaphone", color: "#f59512", tileBg: "rgba(245,149,18,0.15)" },
  { title: "Raise rewards on unclaimed offers", desc: "32% of rewards go unclaimed. Swap low-interest items for experiences or cash.", impact: "Creator Relationship +4 est.", iconKey: "gift", color: "#f59512", tileBg: "rgba(245,149,18,0.15)" },
  { title: "Publish your 8 approved videos", desc: "Approved content sitting unpublished isn't earning impressions. Push to your social pages.", impact: "Social Traction +3 est.", iconKey: "upload", color: "#8c52ff", tileBg: "rgba(140,82,255,0.14)" },
  { title: "Invite repeat guests to film", desc: "14 regulars visited 3+ times this month but haven't posted. Nudge them with a video opportunity.", impact: "Video Stream +2 est.", iconKey: "users", color: "#8c52ff", tileBg: "rgba(140,82,255,0.14)" },
];

/* ---- GET /campaigns ---- */
export const campStats = [
  { label: "Requests sent", value: "412", sub: "3 live campaigns", positive: false },
  { label: "Videos in", value: "47", sub: "+12 this week", positive: true },
  { label: "Claim rate", value: "62%", sub: "up from 51%", positive: true },
  { label: "Rewards paid", value: "$840", sub: "$17.90 per video", positive: false },
];

export const campFunnel = [
  { label: "requests sent", value: "412", flex: 6, bg: "rgba(255,255,255,0.95)" },
  { label: "claimed the reward", value: "170", flex: 3, bg: "rgba(255,255,255,0.55)" },
  { label: "filmed and sent", value: "47", flex: 1.4, bg: "rgba(255,255,255,0.3)" },
];

const campStatus = {
  live: { status: "Live", statusFg: "#0d7a4f", statusBg: "rgba(22,160,107,0.12)" },
  scheduled: { status: "Scheduled", statusFg: "#2563eb", statusBg: "rgba(37,99,235,0.12)" },
  ended: { status: "Ended", statusFg: "#9ca3af", statusBg: "#f1f1f6" },
};

export const campaigns = [
  { ...campStatus.live, id: "c1", title: "Weekday dinner rush", dates: "Jul 8 – Jul 31", ask: "Film your main course on a Tue–Thu evening. 20 seconds is plenty.", reward: "Free dessert", audience: "Regulars · 180 guests", progressLabel: "22 of 30 videos", pct: "73%", barColor: "#8c52ff", sent: "180", claimed: "71", videos: "22", cta: "View videos", delay: "0.12s" },
  { ...campStatus.live, id: "c2", title: "Espresso martini hour", dates: "Jul 1 – Aug 15", ask: "Show the pour. Bar seat, no filter, sound on.", reward: "250 points", audience: "Everyone · 96 guests", progressLabel: "14 of 25 videos", pct: "56%", barColor: "#8c52ff", sent: "96", claimed: "41", videos: "14", cta: "View videos", delay: "0.2s" },
  { ...campStatus.scheduled, id: "c3", title: "Patio season kickoff", dates: "Starts Aug 1", ask: "Golden-hour table shots for the new patio menu.", reward: "Chef's tasting for two", audience: "Top creators · 24 guests", progressLabel: "Not started", pct: "0%", barColor: "#b79aff", sent: "—", claimed: "—", videos: "—", cta: "Edit", delay: "0.28s" },
  { ...campStatus.ended, id: "c4", title: "First-visit reviews", dates: "May 2 – Jun 30", ask: "An honest 30-second take after your first meal with us.", reward: "$10 off next visit", audience: "First-timers · 136 guests", progressLabel: "11 of 10 videos", pct: "100%", barColor: "#16a06b", sent: "136", claimed: "58", videos: "11", cta: "Report", delay: "0.36s" },
];

/* ---- GET /editor/styles ---- */
export const edStyleDefs = [
  { id: "review", name: "Local review", desc: "A guest talks, you cut to the food.", len: "0:25", best: "TikTok", reach: 14200, cpm: 2.4, tags: ["review", "vlog"], caption: "Our regulars said it better than we could. Come find out why.", hashtags: ["#divvitcafe", "#sfeats", "#realreview", "#pastanight"], thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { id: "interior", name: "Simple interior", desc: "Slow pans of the room, no talking.", len: "0:18", best: "Instagram", reach: 9600, cpm: 3.1, tags: ["interior"], caption: "The room at 6pm, before the rush. Save this for date night.", hashtags: ["#divvitcafe", "#sfrestaurants", "#datenight", "#goldenhour"], thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
  { id: "items", name: "Item highlights", desc: "Dish after dish, named on screen.", len: "0:22", best: "TikTok", reach: 16800, cpm: 2.0, tags: ["item"], caption: "Six things on the menu right now. Pick one, we'll save you a table.", hashtags: ["#divvitcafe", "#foodtok", "#sfeats", "#menudrop"], thumbBg: thumb("IMG_8221.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)") },
  { id: "pov", name: "POV walkthrough", desc: "First person, door to table.", len: "0:30", best: "Shorts", reach: 11400, cpm: 2.9, tags: ["vlog", "interior"], caption: "POV: it's Friday and you got the corner booth.", hashtags: ["#divvitcafe", "#pov", "#sfnightout", "#cornerbooth"], thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { id: "ambience", name: "Environment ambience", desc: "Light, sound, nothing else.", len: "0:16", best: "Instagram", reach: 7400, cpm: 3.6, tags: ["interior", "item"], caption: "No talking. Just the light, the room, and the espresso machine.", hashtags: ["#divvitcafe", "#asmr", "#cafevibes", "#sfcoffee"], thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)") },
];

export const edKindLabel: Record<string, string> = { review: "Review", vlog: "Vlog", interior: "Interior", item: "Dish" };

export const edClipLib = [
  { id: "k1", who: "Amir Khan", len: "0:19", kind: "review", thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { id: "k2", who: "Maya Sørensen", len: "0:24", kind: "interior", thumbBg: thumb("IMG_8173.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { id: "k3", who: "Jordan Tran", len: "0:22", kind: "item", thumbBg: thumb("IMG_8186.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)") },
  { id: "k4", who: "Lucia Reyes", len: "0:27", kind: "vlog", thumbBg: thumb("IMG_8189.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
  { id: "k5", who: "Priya Nair", len: "0:15", kind: "item", thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #b3f0d9, #0d7a4f)") },
  { id: "k6", who: "Marcus Bell", len: "0:18", kind: "item", thumbBg: thumb("IMG_8210.jpg", "linear-gradient(135deg, #ffc7b3, #e0642f)") },
  { id: "k7", who: "Ava Chen", len: "0:36", kind: "review", thumbBg: thumb("IMG_8211.jpg", "linear-gradient(135deg, #e8c8ff, #8c52ff)") },
  { id: "k8", who: "Noah Kim", len: "0:27", kind: "interior", thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { id: "k9", who: "Emma Wright", len: "0:31", kind: "vlog", thumbBg: thumb("IMG_8213.jpg", "linear-gradient(135deg, #ffe3a1, #f59512)") },
];

export const edStyleRefs = [
  { name: "Item highlights", note: "Used 24× · avg 16.8K views", thumbBg: thumb("IMG_8221.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { name: "Local review", note: "Used 18× · avg 14.2K views", thumbBg: thumb("IMG_8188.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { name: "POV walkthrough", note: "Used 11× · avg 11.4K views", thumbBg: thumb("IMG_8212.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)") },
];

export const edDrafts = [
  { title: "Friday night, fast cut", when: "Jul 24", state: "Posted", thumbBg: thumb("IMG_8222.jpg", "linear-gradient(135deg, #c4b0ff, #8c52ff)") },
  { title: "The room after dark", when: "Jul 19", state: "Posted", thumbBg: thumb("IMG_8218.jpg", "linear-gradient(135deg, #b7c4ff, #6346cd)") },
  { title: "Six dishes, thirty seconds", when: "Jul 11", state: "Posted", thumbBg: thumb("IMG_8221.jpg", "linear-gradient(135deg, #a7e8cd, #16a06b)") },
  { title: "Patio at golden hour", when: "Jul 6", state: "Draft", thumbBg: thumb("IMG_8194.jpg", "linear-gradient(135deg, #ffd9a1, #f59512)") },
];

/* ---- GET /creators ---- */
export type Creator = {
  rank: string; initials: string; name: string; handle: string;
  videos: number; views: string; reward: string; avatarBg: string;
  tier: "leaderboard" | "regular" | "first"; lastVisit: string;
};

export const creators: Creator[] = [
  { rank: "01", initials: "AK", name: "Amir Khan", handle: "@eatswithamir", videos: 9, views: "41.2K", reward: "Free dinner ×2", avatarBg: "#16a06b", tier: "leaderboard", lastVisit: "2 days ago" },
  { rank: "02", initials: "MS", name: "Maya Sørensen", handle: "Divvit user", videos: 7, views: "18.6K", reward: "$45 cash", avatarBg: "#8c52ff", tier: "leaderboard", lastVisit: "3 days ago" },
  { rank: "03", initials: "JT", name: "Jordan Tran", handle: "Divvit user", videos: 5, views: "9.8K", reward: "Chef's tasting", avatarBg: "#f59512", tier: "regular", lastVisit: "today" },
  { rank: "04", initials: "LR", name: "Lucia Reyes", handle: "@luciafoodie", videos: 4, views: "7.1K", reward: "Free dessert ×3", avatarBg: "#6346cd", tier: "regular", lastVisit: "5 days ago" },
  { rank: "05", initials: "PN", name: "Priya Nair", handle: "@priyaeats", videos: 4, views: "6.3K", reward: "250 points", avatarBg: "#e04f8c", tier: "regular", lastVisit: "1 week ago" },
  { rank: "06", initials: "DP", name: "Devon Park", handle: "Divvit user", videos: 3, views: "4.4K", reward: "15% off", avatarBg: "#2563eb", tier: "regular", lastVisit: "1 week ago" },
  { rank: "07", initials: "NO", name: "Nina Osei", handle: "@ninatries", videos: 2, views: "4.6K", reward: "Free dessert", avatarBg: "#0d7a4f", tier: "first", lastVisit: "yesterday" },
  { rank: "08", initials: "MB", name: "Marcus Bell", handle: "Divvit user", videos: 1, views: "1.2K", reward: "250 points", avatarBg: "#b9700a", tier: "first", lastVisit: "today" },
  { rank: "09", initials: "ZA", name: "Zoe Adams", handle: "@zoedines", videos: 1, views: "3.8K", reward: "—", avatarBg: "#8c52ff", tier: "first", lastVisit: "4 days ago" },
];

export const redemptions = [
  { initials: "AK", name: "Amir Khan", reward: "Free dessert", when: "2 days ago", status: "Fulfilled", avatarBg: "#16a06b" },
  { initials: "DP", name: "Devon Park", reward: "15% off next visit", when: "3 days ago", status: "Fulfilled", avatarBg: "#2563eb" },
  { initials: "LR", name: "Lucia Reyes", reward: "250 bonus points", when: "4 days ago", status: "Pending", avatarBg: "#6346cd" },
  { initials: "AC", name: "Ava Chen", reward: "Chef's tasting for two", when: "1 week ago", status: "Fulfilled", avatarBg: "#f59512" },
  { initials: "ZA", name: "Zoe Adams", reward: "Free main", when: "1 week ago", status: "Expired", avatarBg: "#8c52ff" },
];

export const creatorActivityPool = [
  { who: "Jordan Tran", what: "just uploaded", meta: "0:22 · dinner service", icon: "clapper" as const, fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  { who: "Nina Osei", what: "joined from a video request", meta: "First-time creator", icon: "users" as const, fg: "#16a06b", bg: "rgba(22,160,107,0.12)" },
  { who: "Amir Khan", what: "redeemed Free dessert", meta: "250 pts", icon: "gift" as const, fg: "#f59512", bg: "rgba(245,149,18,0.14)" },
  { who: "Maya Sørensen", what: "hit 18.6K total views", meta: "Top creator", icon: "trendUp" as const, fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  { who: "Priya Nair", what: "claimed a campaign", meta: "Weekday dinner rush", icon: "megaphone" as const, fg: "#6346cd", bg: "rgba(99,70,205,0.12)" },
];

/* ---- GET /search ---- */
export const searchCorpus = [
  { id: "v1", kind: "video", title: "Jordan Tran — summer patio dinner", meta: "0:22 · The Collection · accepted", tags: "dinner patio summer evening pasta" },
  { id: "v2", kind: "video", title: "Priya Nair — dessert close-up", meta: "0:15 · The Collection · new", tags: "dessert sweet close-up tiramisu" },
  { id: "v3", kind: "video", title: "Hana Cho — the room at golden hour", meta: "0:31 · Content Manager · published", tags: "interior ambience room golden hour" },
  { id: "v4", kind: "video", title: "Amir Khan — live music night vlog", meta: "0:44 · Content Manager · published", tags: "event live music night vlog crowd" },
  { id: "v5", kind: "video", title: "SF Brunch Club — weekend brunch spread", meta: "0:28 · The Collection · new", tags: "brunch weekend eggs coffee event" },
  { id: "v6", kind: "video", title: "Lucia Reyes — barista latte art", meta: "0:18 · Content Manager · published", tags: "coffee latte barista morning" },
  { id: "c1", kind: "creator", title: "Amir Khan · @eatswithamir", meta: "9 videos · 41.2K views · top creator", tags: "creator top leaderboard regular" },
  { id: "c2", kind: "creator", title: "Maya Sørensen · Divvit user", meta: "7 videos · 18.6K views", tags: "creator leaderboard" },
  { id: "r1", kind: "report", title: "Organic Brand Health — this week", meta: "Word of mouth 83 · +4", tags: "report brand health score word of mouth reviews sentiment" },
  { id: "p1", kind: "campaign", title: "Weekday dinner rush", meta: "Live · 22 of 30 videos", tags: "campaign live dinner weekday request" },
  { id: "p2", kind: "campaign", title: "Espresso martini hour", meta: "Live · 14 of 25 videos", tags: "campaign live cocktail bar pour" },
  { id: "w1", kind: "reward", title: "Free dessert", meta: "250 pts · 38 of 50 claimed", tags: "reward dessert points claimed menu item" },
  { id: "w2", kind: "reward", title: "Chef's tasting for two", meta: "1,500 pts · 4 of 6 claimed", tags: "reward experience tasting chef premium" },
];

/* ---- Economics: cpm = (rewardsPaidUSD / views) * 1000, server-computed ---- */
export const PAID_CPM_LOW = 7;
export const PAID_CPM_HIGH = 12;

export const fmtK = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n));
