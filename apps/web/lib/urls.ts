/* divvit.app and marketplace.divvit.app are one Next.js app; middleware.ts
   routes by host. These build absolute links between the two. */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3200").replace(/\/$/, "");
export const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || "http://marketplace.localhost:3200").replace(/\/$/, "");

export const site = (path = "/") => `${SITE_URL}${path}`;
export const marketplace = (path = "/") => `${MARKETPLACE_URL}${path}`;
