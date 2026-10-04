/** Remote images go through /api/image so canvases that draw them stay exportable
    (and so third-party hosts don't see our visitors). Data/relative URLs pass through. */
export const proxied = (src: string | null | undefined) =>
  !src ? null : src.startsWith("data:") || src.startsWith("/") ? src : `/api/image?url=${encodeURIComponent(src)}`;
