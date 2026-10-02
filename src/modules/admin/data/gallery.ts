import { api } from "@/lib/api";
import type { AdminResult } from "@/data/repositories/result";
import { call, patch, put, write } from "@/data/repositories/http";

/* A hotel's photo gallery (the owner's D27-243, D27-244), on Settings →
   Property. The pictures are made small in the browser before they are
   sent; the server keeps a JPEG of at most 1600 px and 600 KB, without the
   camera's Exif, twenty a hotel (api/src/modules/admin/gallery.ts). Shown
   here only as an <img> from the bytes the server kept. */

export interface HotelPhoto { id: string; caption: string | null; width: number; height: number }

const at = (code: string, rest = "") => `/api/hotels/${encodeURIComponent(code)}/gallery${rest}`;

export const GALLERY_KEY = (code: string) => ["hotel-gallery", code] as const;

export const listPhotos = (code: string) => api<{ photos: HotelPhoto[]; most: number }>(at(code));

/** One photo as a data: URL for an <img>. */
export const photoSrc = async (code: string, id: string) => {
  const p = await api<{ type: string; data: string }>(at(code, `/${id}`));
  return `data:${p.type};base64,${p.data}`;
};

/** The JPEG's bytes, base64. The server decides whether it is one. */
export const addPhoto = (code: string, data: string): Promise<AdminResult<{ id: string }>> =>
  write(at(code), { data });

export const captionPhoto = (code: string, id: string, caption: string): Promise<AdminResult<object>> =>
  patch(at(code, `/${id}`), { caption });

export const orderPhotos = (code: string, ids: string[]): Promise<AdminResult<object>> =>
  put(at(code, "/order"), { ids });

export const removePhoto = (code: string, id: string): Promise<AdminResult<object>> =>
  call(at(code, `/${id}`), "DELETE");
