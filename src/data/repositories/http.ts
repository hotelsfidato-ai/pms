import { api, ApiError } from "@/lib/api";
import type { AdminResult } from "./result";

/* The data layer's requests, shared by every service's data files. Moved
   here on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md): `fetchOr` was three identical copies
   (billing, directory, reportData), `write`, `patch` and `put` lived in
   admin.ts. Unchanged. Core — imported by data files, never by a screen. */

/** A read that treats "no such thing here" (404) as empty rather than an
    error; anything else still throws. */
export async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return empty;
    throw error;
  }
}

/** A POST that answers with the server's refusal as a value. */
export async function write<T>(
  path: string, body: unknown, key?: string,
): Promise<AdminResult<T>> {
  try {
    const result = await api<T & { ok: true }>(path, {
      method: "POST",
      body: JSON.stringify(body),
      /* The key rides on this one request and nowhere else. */
      ...(key ? { headers: { "x-provisioning-key": key } } : {}),
    });
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

export async function patch<T>(path: string, body: unknown): Promise<AdminResult<T>> {
  try {
    return await api<T & { ok: true }>(path, {
      method: "PATCH", body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

export async function put<T>(path: string, body: unknown): Promise<AdminResult<T>> {
  try {
    return await api<T & { ok: true }>(path, {
      method: "PUT", body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/** A write that answers with the server's refusal as a value, whatever
    the method. Moved here from roomSetup.ts; unchanged. */
export async function call<T>(
  path: string, method: string, body?: unknown,
): Promise<AdminResult<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
