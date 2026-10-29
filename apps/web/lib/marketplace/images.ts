/** Remote images go through /api/image so canvases that draw them stay exportable
    (and so third-party hosts don't see our visitors). Data/relative URLs pass through. */
export const proxied = (src: string | null | undefined) =>
  !src ? null : src.startsWith("data:") || src.startsWith("/") ? src : `/api/image?url=${encodeURIComponent(src)}`;

/** A café's card photo: an owner's upload is served from our own storage; a sample café's stock photo goes through the proxy. */
export const cafePhotoUrl = (photo: string | null | undefined) =>
  !photo ? null : /^https:\/\//.test(photo) ? proxied(photo)
    : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/mp-cafe-photos/${photo.split("/").map(encodeURIComponent).join("/")}`;
