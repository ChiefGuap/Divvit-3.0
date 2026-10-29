"use client";

/* The café marketplace grid: filters on the left, café cards on the right. Each
   card shows the café's photo, how busy it is, how many sleeves it can take for a
   campaign and the real places around it; cards are selected for a campaign. */

import React from "react";
import { Icon } from "./icons";
import { audienceLabel, profileOf } from "@/lib/marketplace/audiences";
import { CARD_WEEKS, dailyCustomers, NEARBY_LABEL, sleevesPerCampaign } from "@/lib/marketplace/cafe-facts";
import { num } from "@/lib/marketplace/format";
import { cafePhotoUrl } from "@/lib/marketplace/images";
import type { Cafe, NearbyKind, NearbyPlace } from "@/lib/marketplace/types";

const HUES = [["#f1ebff", "#e2d6ff"], ["#f6efe4", "#ecdfc9"], ["#e9f3ec", "#d5e8db"], ["#e8f1fb", "#d3e3f6"], ["#fbecee", "#f4d7dc"]];
const hueOf = (id: string) => HUES[[...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % HUES.length];
const KINDS = Object.keys(NEARBY_LABEL) as NearbyKind[];

type Sort = "busiest" | "sleeves" | "name";

/** match / kinds: what the filters are looking for; places that fit are shown first */
export function CafeCard({ cafe, selected, onSelect, match = "", kinds = [] }: {
  cafe: Cafe; selected: boolean; onSelect: () => void; match?: string; kinds?: NearbyKind[];
}) {
  const [a, b] = hueOf(cafe.id);
  const [broken, setBroken] = React.useState(false);
  const photo = broken ? null : cafePhotoUrl(cafe.photo);
  const all = cafe.nearby ?? [];
  const hit = (x: NearbyPlace) => (Boolean(match) && x.name.toLowerCase().includes(match)) || kinds.includes(x.kind);
  const near = [...all.filter(hit), ...all.filter((x) => !hit(x))].slice(0, 3);
  const profile = near.length ? null : profileOf(cafe.city, cafe.neighborhood);
  return (
    <article className={`cafe-card${selected ? " on" : ""}`}>
      <div className="cover" style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}
        title={cafe.is_demo && photo ? "Sample café, shown with a stock photo" : undefined}>
        {photo ? <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          : <span className="initial" aria-hidden>{cafe.name.trim()[0]}</span>}
        {cafe.is_demo && <span className="badge">Sample café</span>}
      </div>
      <div className="body">
        <b className="name">{cafe.name}</b>
        <small className="loc">{[cafe.neighborhood, cafe.city].filter(Boolean).join(", ")}</small>
        <div className="nums">
          <div><b>{num(dailyCustomers(cafe))}</b><span>est. daily customers</span></div>
          <div title={`Over a ${CARD_WEEKS}-week campaign`}><b>{num(sleevesPerCampaign(cafe))}</b><span>sleeves per campaign</span></div>
        </div>
        {near.length > 0 ? (
          <span className="aud" title={near.map((x) => `${x.name} — ${NEARBY_LABEL[x.kind]}, ${num(x.m)} m away`).join("\n")}>
            Near {near.map((x) => x.name).join(" · ")}
          </span>
        ) : profile && <span className="aud">{audienceLabel(profile.tags)}</span>}
        <div className="tags">
          {cafe.branded_drinks && <span>Branded drink</span>}
          {!cafe.is_demo && <span>Verified</span>}
        </div>
        <button type="button" className={`pick${selected ? " on" : ""}`} onClick={onSelect} aria-pressed={selected}>
          {selected ? <><Icon name="check" size={15} /> Selected</> : <><Icon name="plus" size={15} /> Select</>}
        </button>
      </div>
    </article>
  );
}

export function CafeMarket({ title, cafes, selected, onSelect, empty }: {
  title: string; cafes: Cafe[]; selected: Set<string>; onSelect: (id: string) => void; empty: React.ReactNode;
}) {
  const [busy, setBusy] = React.useState(0);
  const [sleeves, setSleeves] = React.useState(0);
  const [drink, setDrink] = React.useState(false);
  const [hoods, setHoods] = React.useState<string[]>([]);
  const [kinds, setKinds] = React.useState<NearbyKind[]>([]);
  const [place, setPlace] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("busiest");
  const [shown, setShown] = React.useState(12);
  const q = place.trim().toLowerCase();

  const allHoods = React.useMemo(() => {
    const n = new Map<string, number>();
    cafes.forEach((c) => c.neighborhood && n.set(c.neighborhood, (n.get(c.neighborhood) ?? 0) + 1));
    return [...n.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
  }, [cafes]);
  const nearCount = (k: NearbyKind) => cafes.filter((c) => c.nearby?.some((x) => x.kind === k)).length;

  const list = React.useMemo(() => cafes
    .filter((c) => dailyCustomers(c) >= busy && sleevesPerCampaign(c) >= sleeves && (!drink || c.branded_drinks)
      && (!hoods.length || (c.neighborhood && hoods.includes(c.neighborhood)))
      && (!kinds.length || Boolean(c.nearby?.some((x) => kinds.includes(x.kind))))
      && (!q || Boolean(c.nearby?.some((x) => x.name.toLowerCase().includes(q)))))
    .sort((x, y) => (sort === "name" ? x.name.localeCompare(y.name) : sort === "sleeves" ? y.sleeves_per_month - x.sleeves_per_month : y.weekly_cups - x.weekly_cups)),
  [cafes, busy, sleeves, drink, hoods, kinds, q, sort]);

  React.useEffect(() => setShown(12), [cafes, busy, sleeves, drink, hoods, kinds, q, sort]);
  const opt = (v: number, cur: number, set: (n: number) => void, label: string) => (
    <button type="button" className={`f-chip${cur === v ? " on" : ""}`} onClick={() => set(v)}>{label}</button>
  );
  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, v: T) => set((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]));

  return (
    <div className="dash-market">
      <aside className="filters" aria-label="Filters">
        <b className="f-title">Filters</b>
        <div className="f-group"><span>Near</span>
          <input className="f-search" type="search" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="A place, e.g. NYU or Google" aria-label="Near a place" />
          {KINDS.map((k) => (
            <label key={k} className="f-check">
              <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(setKinds, k)} />
              {NEARBY_LABEL[k]} <small>{nearCount(k)}</small>
            </label>
          ))}
        </div>
        <div className="f-group"><span>Daily customers</span>
          <div className="f-chips">{opt(0, busy, setBusy, "Any")}{opt(200, busy, setBusy, "200+")}{opt(350, busy, setBusy, "350+")}</div>
        </div>
        <div className="f-group"><span>Sleeves per campaign</span>
          <div className="f-chips">{opt(0, sleeves, setSleeves, "Any")}{opt(1500, sleeves, setSleeves, "1,500+")}{opt(3000, sleeves, setSleeves, "3,000+")}</div>
        </div>
        <label className="f-check"><input type="checkbox" checked={drink} onChange={(e) => setDrink(e.target.checked)} /> Offers branded drinks</label>
        {allHoods.length > 1 && (
          <div className="f-group"><span>Neighborhood</span>
            {allHoods.map(([h, n]) => (
              <label key={h} className="f-check">
                <input type="checkbox" checked={hoods.includes(h)} onChange={() => toggle(setHoods, h)} />
                {h} <small>{n}</small>
              </label>
            ))}
          </div>
        )}
      </aside>

      <div className="results">
        <div className="r-head">
          <b className="r-title">{title} <small>{num(list.length)}</small></b>
          <label className="sort">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="busiest">Busiest first</option>
              <option value="sleeves">Most sleeves</option>
              <option value="name">A–Z</option>
            </select>
          </label>
        </div>
        {list.length === 0 ? <div className="mp-empty">{empty}</div> : (
          <>
            <div className="grid">
              {list.slice(0, shown).map((c) => (
                <CafeCard key={c.id} cafe={c} selected={selected.has(c.id)} onSelect={() => onSelect(c.id)} match={q} kinds={kinds} />
              ))}
            </div>
            {shown < list.length && <button type="button" className="mp-btn more" onClick={() => setShown((s) => s + 12)}>Show more cafés</button>}
          </>
        )}
      </div>
    </div>
  );
}
