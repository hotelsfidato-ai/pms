import { Navigate, Route } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import { PropertyScope } from "@/components/app/PropertyScope";
import { IS_DEV } from "@/components/app/navigation";
import PropertyPage from "@/modules/admin/pages/Property";
import PeoplePage from "@/modules/admin/pages/People";
import AdminConsolePage from "@/modules/admin/pages/Console";
import SystemHealthPage from "@/modules/admin/pages/SystemHealth";
import SettingsPage from "@/modules/admin/pages/Settings";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import ActivityPage from "@/modules/admin/pages/Activity";
import {
  UsersPage, RolesPage, AuditLogPage, IntegrationsPage,
} from "@/modules/admin/pages/Admin";

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
        actually has staff to add -- could not reach them.

        ⚠ GUARDED SINCE 16 SEPTEMBER (PEO-1). It was mounted bare, so
        a reception clerk who typed /people got the screen — with Add
        somebody, Password, Edit and Deactivate on it. Nothing leaked
        (the database showed them their own row and the server refused
        every button), but the menu hid the entry while the route let
        them in, which is the disagreement `mayReach` exists to remove.
        The guard asks the navigation, so the hidden link and the
        refused page now give one answer. */}
    <Route
      path="/people"
      element={
        <RequireAccess path="/people" resource="user">
          <PeoplePage />
        </RequireAccess>
      }
    />

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
    {/* D27-243 (5.1): every change, not only the money's. */}
    <Route
      path="/admin/activity"
      element={
        <RequireAccess path="/admin/activity" resource="audit_log">
          <ActivityPage />
        </RequireAccess>
      }
    />
    {/* D27-255: Sign-ins and devices moved into the Settings console
        (people.settings.ts); the old address goes there (MEMORY 375). */}
    <Route path="/admin/sign-ins" element={<Navigate to="/settings/people/devices" replace />} />
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
      path="/admin/system-health"
      element={
        <RequireAccess path="/admin/system-health" resource="role">
          <SystemHealthPage />
        </RequireAccess>
      }
    />
    {/* D27-213, D27-214: ONE place for settings, its tab in the address.
        Asked as "/settings" whichever tab: the menu entry is the rule. */}
    {["/settings", "/settings/:tab"].map((path) => (
      <Route
        key={path}
        path={path}
        element={
          <RequireAccess path="/settings" resource="setting">
            <SettingsPage />
          </RequireAccess>
        }
      />
    ))}
    {/* With the hotel in the address (D27-216): the group owner's bell links to
        the hotel whose bank details changed, whichever one is open. The
        top bar's hotel follows the address (PropertyScope), as on every
        /h/:code screen. */}
    <Route
      path="/h/:code/settings/:tab"
      element={
        <RequireAccess path="/settings" resource="setting">
          <PropertyScope /><SettingsPage />
        </RequireAccess>
      }
    />
    {/* The two screens it replaced: their addresses open it. Configuration
        was where the refusals sent people to set GST. */}
    <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
    <Route path="/admin/configuration" element={<Navigate to="/settings/taxes-and-billing" replace />} />
  </>
);
