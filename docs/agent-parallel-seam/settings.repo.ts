import { queryKeys } from "./index";

/* ═════════════════════════════════════════════════════════════════
   SETTINGS REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.             ═════ */

export interface PropertySettings {
  allowRoleSwitching: boolean;
  checkInTime: string; // "14:00"
  checkOutTime: string; // "11:00"
  taxInclusive: boolean;
  cgstRate: number; // 6
  sgstRate: number; // 6
  defaultCurrency: string; // "INR"
  invoiceSeries: string; // "FID-{YYYY}-{NNNNN}"
  nightAuditTime: string; // "03:00"
  supportedPaymentMethods: string[];
  channelManagers: string[];
}

export interface SystemSettings {
  appName: string;
  supportEmail: string;
  maintenanceMode: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  sessionTimeoutMinutes: number;
}

const defaultPropertySettings: PropertySettings = {
  allowRoleSwitching: true,
  checkInTime: "14:00",
  checkOutTime: "11:00",
  taxInclusive: true,
  cgstRate: 6,
  sgstRate: 6,
  defaultCurrency: "INR",
  invoiceSeries: "FID-{YYYY}-{NNNNN}",
  nightAuditTime: "03:00",
  supportedPaymentMethods: ["Cash", "UPI", "Card", "GoMMT", "Room Posting"],
  channelManagers: ["RateGain", "STAAH", "Hotelogix", "Siteminder"],
};

const defaultSystemSettings: SystemSettings = {
  appName: "Fidato PMS",
  supportEmail: "support@fidato.in",
  maintenanceMode: false,
  logLevel: "info",
  sessionTimeoutMinutes: 480,
};

let propertySettingsCache: Map<string, PropertySettings> = new Map();
let systemSettingsCache: SystemSettings = defaultSystemSettings;

export const settingsRepo = {
  /** Get property-level settings */
  getPropertySettings: async (hotelId: string): Promise<PropertySettings> => {
    if (!propertySettingsCache.has(hotelId)) {
      propertySettingsCache.set(hotelId, { ...defaultPropertySettings });
    }
    return propertySettingsCache.get(hotelId)!;
  },

  /** Update property-level settings */
  updatePropertySettings: async (hotelId: string, settings: Partial<PropertySettings>): Promise<PropertySettings> => {
    const current = await settingsRepo.getPropertySettings(hotelId);
    const updated = { ...current, ...settings };
    propertySettingsCache.set(hotelId, updated);
    return updated;
  },

  /** Get system-level settings */
  getSystemSettings: async (): Promise<SystemSettings> => {
    return systemSettingsCache;
  },

  /** Update system-level settings */
  updateSystemSettings: async (settings: Partial<SystemSettings>): Promise<SystemSettings> => {
    systemSettingsCache = { ...systemSettingsCache, ...settings };
    return systemSettingsCache;
  },

  /** Reset property settings to defaults */
  resetPropertySettings: async (hotelId: string): Promise<PropertySettings> => {
    propertySettingsCache.set(hotelId, { ...defaultPropertySettings });
    return defaultPropertySettings;
  },
};

/* TanStack Query helpers */

export const usePropertySettings = (hotelId: string) => ({
  queryKey: ["settings", "property", hotelId],
  queryFn: () => settingsRepo.getPropertySettings(hotelId),
});

export const useSystemSettings = () => ({
  queryKey: ["settings", "system"],
  queryFn: () => settingsRepo.getSystemSettings(),
});