import { ApiError, apiBase } from "@/lib/api";

/** A form upload - a photo cannot go through `api()`, which always sends
    JSON. The browser writes the form's own content type. A refusal is
    thrown as an ApiError carrying the server's sentence, like `api()`'s,
    so a screen prints it the same way; a photo is never kept on the device
    to send later. */
export async function upload<T>(
  base: string, path: string, form: FormData, headers: HeadersInit | undefined,
): Promise<T> {
  const sent = new Headers(headers ?? {});
  sent.delete("content-type");
  let res: Response;
  try {
    res = await fetch(`${await apiBase()}${base}${path}`, { method: "POST", headers: sent, body: form });
  } catch {
    throw new ApiError(0, "Could not reach the server. Try again when you are connected.");
  }
  const body = (await res.json().catch(() => null)) as ({ error?: string; reason?: string } & T) | null;
  if (!res.ok || body === null) {
    throw new ApiError(res.status, body?.error ?? body?.reason ?? `Request failed (${res.status}).`, body);
  }
  return body;
}
