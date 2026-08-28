import * as admin from "./admin";

/* Object surface over ./admin. */

export const settingsRepo = {
  get: admin.getAdminSettings,
  roles: admin.listRoles,
  assignableRoles: admin.listAssignableRoles,
  matrix: admin.getMatrix,
};
