"use client";

/* The in-progress signup, held in the browser until there is an account to
   attach it to.

   Onboarding spans several screens and there is no auth yet, so the draft
   lives in localStorage rather than a server session. Two consequences worth
   being deliberate about:

   **No password is ever stored here.** It is used on the screen that collects
   it and then dropped. localStorage is readable by any script on the origin,
   and a half-finished signup is not worth leaving a credential lying around
   for.

   **Every read is guarded.** localStorage throws in private windows and when
   a browser blocks site data, and a signup flow that white-screens because
   storage is unavailable is worse than one that simply starts over. */

import React from "react";

const KEY = "dv.onboarding.draft.v1";

export type Draft = {
  email: string;
  venueId: string | null;
  venueName: string;
  city: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  tiktok: string;
  /** Set when the venue was found in the roster rather than typed by hand. */
  claimedFromRoster: boolean;
  brandHealth: number | null;
};

export const EMPTY: Draft = {
  email: "", venueId: null, venueName: "", city: "", address: "", phone: "",
  website: "", instagram: "", tiktok: "", claimedFromRoster: false,
  brandHealth: null,
};

function read(): Draft {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(d: Draft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage unavailable. The flow still works within the session; only
    // resuming after a reload is lost, which is the right thing to trade.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nothing to clean up */ }
}

/** Draft plus a merge-updater. Reads once on mount so SSR and the first client
 *  render agree — reading during render would hydrate-mismatch. */
export function useDraft(): [Draft, (patch: Partial<Draft>) => void, boolean] {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setDraft(read());
    setLoaded(true);
  }, []);

  const update = React.useCallback((patch: Partial<Draft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      write(next);
      return next;
    });
  }, []);

  return [draft, update, loaded];
}
