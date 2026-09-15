import { Navigate, Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import { IS_DEV } from "@/components/app/navigation";
import PropertyPage from "@/pages/Property";
import PeoplePage from "@/pages/People";
import AdminConsolePage from "@/pages/admin/Console";
import { PropertiesPage } from "@/pages/Directory";
import {
  UsersPage, RolesPage, AuditLogPage, IntegrationsPage,
  SettingsPage,
} from "@/pages/admin/Admin";

/* Administration's screen addresses. Mounted by App.tsx inside the
   signed-in shell. */
export const routes = (
  <>
    <Route path="/properties" element={<PropertiesPage />} />
    {/* One property: its own numbers, and the people who work
        there. Scoped by hotel rather than by rank — a general
        manager gets this for theirs and a 404 for anybody
        else's, because it carries the GSTIN. */}
    <Route path="/properties/:code" element={<PropertyPage />} />
    {/* NOT development-gated. The endpoints behind it have
        existed since the admin work and were reachable only from
        a dev-only console, so the owner -- the one person who
        actually has staff to add -- could not reach them. */}
    <Route path="/people" element={<PeoplePage />} />

    <Route
      /* ⚠ A REDIRECT, NOT A SECOND COPY OF THE SCREEN. There
         were two Properties screens and they were merged on
         9 September; pointing this route at `PropertiesPage`
         left an /admin path whose only authorisation lived in
         a navigation entry — and removing that entry to fix a
         duplicate label silently opened it, because
         `mayReach` returns TRUE for a path the navigation does
         not contain. The guard fails OPEN.

         A redirect has nothing to fail. The old link still
         works, and it lands on the screen that answers for its
         own access. */
      path="/admin/properties"
      element={<Navigate to="/properties" replace />}
    />
    <Route
      path="/admin/users"
      element={
        <RequireAccess path="/admin/users" resource="user">
          <UsersPage />
        </RequireAccess>
      }
    />
    <Route
      path="/admin/roles"
      element={
        <RequireAccess path="/admin/roles" resource="role">
          <RolesPage />
        </RequireAccess>
      }
    />
    <Route
      path="/admin/audit-log"
      element={
        <RequireAccess path="/admin/audit-log" resource="audit_log">
          <AuditLogPage />
        </RequireAccess>
      }
    />
    <Route
      path="/admin/integrations"
      element={
        <RequireAccess path="/admin/integrations" resource="integration">
          <IntegrationsPage />
        </RequireAccess>
      }
    />
    {/* The console is gated on the ROUTE, not only in the
        navigation. Hiding a link has never been access control —
        that lesson cost a defect earlier in this build, when a
        clerk could type /admin/users and get the page. In a
        production build this route does not exist at all, so
        there is nothing to type. */}
    {IS_DEV && (
      <Route
        path="/admin/console"
        element={
          <RequireAccess path="/admin/console" resource="hotel">
            <AdminConsolePage />
          </RequireAccess>
        }
      />
    )}
    <Route
      path="/admin/settings"
      element={
        <RequireAccess path="/admin/settings" resource="setting">
          <SettingsPage />
        </RequireAccess>
      }
    />
  </>
);
