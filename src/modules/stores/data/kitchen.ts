import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S STOCK (the owner's D27-373, D27-374) - the screen's calls.
   The server's half: api/src/modules/stores/kitchenSheet.ts.
   ══════════════════════════════════════════════════════════════════ */

export interface KitchenItem {
  id: string; name: string; unit: string;
  opening: number; received: number; movedIn: number; movedOut: number;
  used: number; wasted: number; corrected: number; closing: number;
  /** What the store holds now: the book a count today is against. */
  onHand: number;
  /** The day's last closing count and the book it was counted against; null when not counted. */
  counted: number | null; countBook: number | null;
}

export interface KitchenSheet {
  businessDate: string; date: string;
  store: { id: string; name: string; isActive: boolean } | null;
  /** The stores that may be marked the kitchen's (for those who keep it). */
  stores: { id: string; name: string }[];
  mayKeep: boolean; mayCount: boolean;
  items: KitchenItem[];
  wasted: { item: string; unit: string; quantity: number; note: string | null; reference: string | null }[];
}

export interface RecipeLine { stockItemId: string; name: string; unit: string; quantity: number }

export interface RecipeOwner {
  kind: "dish" | "size" | "side" | "addon";
  itemId: string | null; variationId: string | null; addonId: string | null; numberedAddonId: string | null;
  name: string; section: string; lines: RecipeLine[];
}

export interface Recipes {
  store: { id: string; name: string } | null;
  mayKeep: boolean;
  ingredients: { id: string; name: string; unit: string }[];
  owners: RecipeOwner[];
  withoutRecipe: { itemId: string; name: string; section: string }[];
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

async function send<T>(path: string, method: string, body: unknown): Promise<Result<T>> {
  try {
    return await api<Result<T>>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const getKitchenSheet = (hotelId: string, date?: string) =>
  api<KitchenSheet>(`/api/hotels/${hotelId}/kitchen-stock/sheet${date ? `?date=${date}` : ""}`);

export const saveKitchenCount = (hotelId: string, lines: { itemId: string; book: number; counted: number }[]) =>
  send<{ recorded: number; matched: number }>(`/api/hotels/${hotelId}/kitchen-stock/count`, "POST", { lines });

export const markKitchenStore = (hotelId: string, locationId: string) =>
  send<{ store: string }>(`/api/hotels/${hotelId}/kitchen-stock/store`, "PUT", { locationId });

export const getRecipes = (hotelId: string) => api<Recipes>(`/api/hotels/${hotelId}/kitchen-stock/recipes`);

export const saveRecipe = (
  hotelId: string, owner: Pick<RecipeOwner, "itemId" | "variationId" | "addonId" | "numberedAddonId">,
  lines: { stockItemId: string; quantity: number }[],
) => send(`/api/hotels/${hotelId}/kitchen-stock/recipes`, "PUT", { ...owner, lines });
