"use client";

/* The café network on a map (MapLibre + OpenFreeMap tiles — no API key).
   Cafés are coloured by state: selected / available / not a match. */

import React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Cafe } from "@/lib/marketplace/types";

type BBox = [number, number, number, number];
type Props = {
  cafes: Cafe[];
  selected?: Set<string>;
  isEligible?: (c: Cafe) => boolean;
  areas?: { bbox: BBox }[];
  focus?: BBox | null;
  onToggle?: (id: string) => void;
  className?: string;
  legend?: boolean;
  tag?: React.ReactNode;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const US: BBox = [-124.8, 24.4, -66.9, 49.4];

export function CafeMap({ cafes, selected, isEligible, areas, focus, onToggle, className, legend = true, tag }: Props) {
  const el = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = React.useState(false);
  const toggleRef = React.useRef(onToggle);
  toggleRef.current = onToggle;

  React.useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: "https://tiles.openfreemap.org/styles/positron",
      bounds: US,
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

    m.on("load", () => {
      m.addSource("areas", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": "#8c52ff", "fill-opacity": 0.06 } });
      m.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": "#8c52ff", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      m.addSource("cafes", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "cafes-halo", type: "circle", source: "cafes", filter: ["==", ["get", "state"], "selected"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 7, 13, 16], "circle-color": "#8c52ff", "circle-opacity": 0.16 },
      });
      m.addLayer({
        id: "cafes", type: "circle", source: "cafes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            3, ["match", ["get", "state"], "selected", 4, "eligible", 3.2, 2.6],
            13, ["match", ["get", "state"], "selected", 9, "eligible", 7, 5.5]],
          "circle-color": ["match", ["get", "state"], "selected", "#8c52ff", "eligible", "#b48aff", "#c9c4d8"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["match", ["get", "state"], "selected", 2, 1],
        },
      });
      m.on("mouseenter", "cafes", (e) => {
        m.getCanvas().style.cursor = toggleRef.current ? "pointer" : "";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { name: string; where: string; state: string; note: string };
        const html = document.createElement("div");
        const b = document.createElement("b"); b.textContent = p.name;
        const s = document.createElement("span"); s.textContent = `${p.where}${p.note ? ` · ${p.note}` : ""}`;
        html.append(b, s);
        popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(html).addTo(m);
      });
      m.on("mouseleave", "cafes", () => { m.getCanvas().style.cursor = ""; popup.remove(); });
      m.on("click", "cafes", (e) => {
        const f = e.features?.[0];
        if (f && toggleRef.current && f.properties?.state !== "ineligible") toggleRef.current(String(f.properties!.id));
      });
      setReady(true);
    });
    map.current = m;
    return () => { popup.remove(); m.remove(); map.current = null; };
  }, []);

  // keep the café dots in sync
  React.useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: cafes.map((c) => {
        const eligible = isEligible ? isEligible(c) : true;
        const state = selected?.has(c.id) ? "selected" : eligible ? "eligible" : "ineligible";
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
          properties: {
            id: c.id, name: c.name, state,
            where: [c.neighborhood, c.city].filter(Boolean).join(", "),
            note: state === "ineligible" ? "not a match" : state === "selected" ? "in your campaign" : "",
          },
        };
      }),
    };
    (m.getSource("cafes") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  }, [ready, cafes, selected, isEligible]);

  React.useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: (areas ?? []).map(({ bbox: [w, s, e, n] }) => ({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      })),
    };
    (m.getSource("areas") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  }, [ready, areas]);

  // "zoom into that range" when a location is picked
  React.useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.fitBounds(focus ?? US, { padding: 48, maxZoom: 13.5, duration: focus ? 1400 : 800 });
  }, [ready, focus]);

  return (
    <div className={`mp-map${className ? ` ${className}` : ""}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {legend && (
        <div className="mp-map-legend">
          <span><i style={{ background: "#8c52ff" }} />Selected</span>
          <span><i style={{ background: "#b48aff" }} />Available</span>
          {isEligible && <span><i style={{ background: "#c9c4d8" }} />Not a match</span>}
        </div>
      )}
      {tag && <div className="mp-map-tag">{tag}</div>}
    </div>
  );
}
