import { queryKeys } from "./index";

/* ═════════════════════════════════════════════════════════════════
   ADMIN REPOSITORY
   Users, roles, integrations, audit log, settings.
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.             ═════ */

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  hotelIds: string[];
  status: "active" | "inactive" | "invited";
  createdAt: string;
  lastLoginAt?: string;
}

export interface Role {
  id: string;
  label: string;
  description: string;
  grants: Record<string, string[]>;
}

export interface Integration {
  id: string;
  name: string;
  type: "channel-manager" | "pos" | "payment" | "accounting";
  status: "connected" | "disconnected" | "error" | "configuring";
  lastSync?: string;
  config: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
  ip?: string;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  rooms: number;
  roomTypes: string[];
  rateTypes: string[];
  tax: { cgst: number; sgst: number };
  paymentMethods: string[];
}

/* Demo data */
const demoUsers: User[] = [
  { id: "user-001", name: "Owner", email: "owner@fidato.in", role: "owner", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-01-15T10:00:00Z", lastLoginAt: new Date().toISOString() },
  { id: "user-002", name: "Admin", email: "admin@fidato.in", role: "admin", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-01-20T10:00:00Z", lastLoginAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "user-003", name: "Manager", email: "manager@fidato.in", role: "manager", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-02-01T10:00:00Z", lastLoginAt: new Date(Date.now() - 1800000).toISOString() },
  { id: "user-004", name: "Front Desk", email: "frontdesk@fidato.in", role: "front_desk", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-02-10T10:00:00Z", lastLoginAt: new Date(Date.now() - 600000).toISOString() },
  { id: "user-005", name: "Housekeeping", email: "hk@fidato.in", role: "housekeeping", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-02-15T10:00:00Z", lastLoginAt: new Date(Date.now() - 300000).toISOString() },
  { id: "user-006", name: "Finance", email: "finance@fidato.in", role: "finance", hotelIds: ["5-elements-akkalkot"], status: "active", createdAt: "2025-03-01T10:00:00Z", lastLoginAt: new Date(Date.now() - 7200000).toISOString() },
];

const demoIntegrations: Integration[] = [
  { id: "int-001", name: "RateGain", type: "channel-manager", status: "connected", lastSync: new Date(Date.now() - 300000).toISOString(), config: { propertyId: "RG-12345" } },
  { id: "int-002", name: "STAAH", type: "channel-manager", status: "connected", lastSync: new Date(Date.now() - 600000).toISOString(), config: { propertyId: "ST-67890" } },
  { id: "int-003", name: "Sattva POS", type: "pos", status: "connected", lastSync: new Date(Date.now() - 180000).toISOString(), config: { outletId: "SV-001" } },
  { id: "int-004", name: "Razorpay", type: "payment", status: "connected", lastSync: new Date(Date.now() - 60000).toISOString(), config: { keyId: "rzp_test_..." } },
  { id: "int-005", name: "Tally", type: "accounting", status: "error", lastSync: new Date(Date.now() - 3600000).toISOString(), config: { companyId: "TL-001" } },
];

const demoAuditLog: AuditLogEntry[] = [
  { id: "audit-001", userId: "user-002", userName: "Admin", action: "updated", resource: "user", resourceId: "user-004", before: { role: "front_desk" }, after: { role: "manager" }, at: new Date(Date.now() - 86400000).toISOString() },
  { id: "audit-002", userId: "user-001", userName: "Owner", action: "created", resource: "property", resourceId: "5-elements-akkalkot", after: { name: "5 Elements Akkalkot" }, at: new Date(Date.now() - 172800000).toISOString() },
  { id: "audit-003", userId: "user-003", userName: "Manager", action: "approved", resource: "rate_override", resourceId: "res-007", before: { rate: 4500 }, after: { rate: 3800 }, at: new Date(Date.now() - 3600000).toISOString() },
  { id: "audit-004", userId: "system", userName: "Automation", action: "completed", resource: "night_audit", resourceId: "2026-08-25", after: { roomsPosted: 17, revenue: 124500 }, at: new Date(Date.now() - 14400000).toISOString() },
];

export const adminRepo = {
  /* Users */
  listUsers: async (_hotelId: string): Promise<User[]> => {
    return demoUsers.filter((u) => u.hotelIds.includes(hotelId));
  },

  getUser: async (_hotelId: string, id: string): Promise<User | null> => {
    return demoUsers.find((u) => u.id === id && u.hotelIds.includes(hotelId)) ?? null;
  },

  createUser: async (_hotelId: string, user: Omit<User, "id" | "createdAt">): Promise<User> => {
    const newUser: User = {
      ...user,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    demoUsers.push(newUser);
    return newUser;
  },

  updateUser: async (_hotelId: string, id: string, updates: Partial<User>): Promise<User | null> => {
    const idx = demoUsers.findIndex((u) => u.id === id && u.hotelIds.includes(hotelId));
    if (idx === -1) return null;
    demoUsers[idx] = { ...demoUsers[idx], ...updates };
    return demoUsers[idx];
  },

  deleteUser: async (_hotelId: string, id: string): Promise<boolean> => {
    const idx = demoUsers.findIndex((u) => u.id === id && u.hotelIds.includes(hotelId));
    if (idx === -1) return false;
    demoUsers.splice(idx, 1);
    return true;
  },

  /* Roles */
  listRoles: async (): Promise<Role[]> => {
    // Import from permissions to get the matrix
    const { permissionMatrix } = await import("@/lib/permissions");
    return permissionMatrix();
  },

  /* Integrations */
  listIntegrations: async (_hotelId: string): Promise<Integration[]> => {
    return demoIntegrations.filter((i) => i.config.propertyId?.toString().includes(hotelId) || true);
  },

  getIntegration: async (_hotelId: string, id: string): Promise<Integration | null> => {
    return demoIntegrations.find((i) => i.id === id) ?? null;
  },

  updateIntegration: async (_hotelId: string, id: string, updates: Partial<Integration>): Promise<Integration | null> => {
    const idx = demoIntegrations.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    demoIntegrations[idx] = { ...demoIntegrations[idx], ...updates };
    return demoIntegrations[idx];
  },

  /* Audit Log */
  listAuditLog: async (_hotelId: string, from?: string, to?: string): Promise<AuditLogEntry[]> => {
    let results = demoAuditLog;
    if (from) results = results.filter((a) => a.at >= from);
    if (to) results = results.filter((a) => a.at <= to);
    return results.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  },

  /* Properties */
  listProperties: async (): Promise<Property[]> => {
    return [
      {
        id: "5-elements-akkalkot",
        name: "5 Elements Akkalkot",
        address: "Survey No. 45, Akkalkot Road, Solapur, Maharashtra 413216",
        phone: "+91 217 222 3333",
        email: "akkalkot@5elementshotels.com",
        gstin: "27AAACF1234A1Z5",
        currency: "INR",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        rooms: 17,
        roomTypes: ["Superior", "Deluxe"],
        rateTypes: ["EP", "CP", "MAP", "Room Only"],
        tax: { cgst: 6, sgst: 6 },
        paymentMethods: ["Cash", "UPI", "Card", "GoMMT", "Room Posting"],
      },
    ];
  },

  getProperty: async (id: string): Promise<Property | null> => {
    const properties = await adminRepo.listProperties();
    return properties.find((p) => p.id === id) ?? null;
  },

  createProperty: async (property: Omit<Property, "id">): Promise<Property> => {
    const newProperty: Property = {
      ...property,
      id: property.name.toLowerCase().replace(/\s+/g, "-"),
    };
    return newProperty;
  },

  /* Settings */
  settings: async (): Promise<{ allowRoleSwitching: boolean }> => {
    return { allowRoleSwitching: true };
  },
};

/* TanStack Query helpers */

export const useUsers = (hotelId: string) => ({
  queryKey: ["users", hotelId],
  queryFn: () => adminRepo.listUsers(hotelId),
});

export const useUser = (hotelId: string, id: string) => ({
  queryKey: ["user", hotelId, id],
  queryFn: () => adminRepo.getUser(hotelId, id),
});

export const useRoles = () => ({
  queryKey: ["roles"],
  queryFn: () => adminRepo.listRoles(),
});

export const useIntegrations = (hotelId: string) => ({
  queryKey: ["integrations", hotelId],
  queryFn: () => adminRepo.listIntegrations(hotelId),
});

export const useAuditLog = (hotelId: string, from?: string, to?: string) => ({
  queryKey: ["audit-log", hotelId, from, to],
  queryFn: () => adminRepo.listAuditLog(hotelId, from, to),
});

export const useProperties = () => ({
  queryKey: queryKeys.properties(),
  queryFn: () => adminRepo.listProperties(),
});

export const useProperty = (id: string) => ({
  queryKey: queryKeys.property(id),
  queryFn: () => adminRepo.getProperty(id),
});