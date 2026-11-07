import { Navigate, Route, useLocation } from "react-router";
import { RequireAccess } from "@/components/app/RequireAccess";
import { PropertyScope } from "@/components/app/PropertyScope";
import { IS_DEV, mayReach } from "@/components/app/navigation";
import { useRole } from "@/lib/session";
import PropertyPage from "@/modules/admin/pages/Property";
import PeoplePage from "@/modules/admin/pages/People";
import AdminConsolePage from "@/modules/admin/pages/Console";
import SystemHealthPage from "@/modules/admin/pages/SystemHealth";
import SettingsPage, { SettingsForHotel } from "@/modules/admin/pages/Settings";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import {
  UsersPage, IntegrationsPage,
} from "@/modules/admin/pages/Admin";
import { SETUP_PAGE } from "@/modules/admin/setup/steps";
import BackfillPage from "@/modules/admin/backfill/BackfillPage";

/* /h/:code/setup is the setup's address with the hotel in it (the bell's
   reminder and "Back to setup" use it). The page itself is a Settings page,
   so the hotel is taken from the address (PropertyScope) and ?step= goes
   with it. */
function SetupForHotel() {
  return <Navigate to={{ pathname: SETUP_PAGE, search: useLocation().search }} replace />;
}

/* D27-398: whoever has Settings is sent to Backfill data there; the
   Accountant reads it here; anybody else is refused, with the reason. */
const BACKFILL_PAGE = "/settings/property/backfill-data";
function BackfillForHotel() {
  const role = useRole();
  return mayReach(role, BACKFILL_PAGE) ? <Navigate to={BACKFILL_PAGE} replace /> : (
    <RequireAccess path="/h/:code/backfill" resource="invoice"><BackfillPage /></RequireAccess>
  );
}

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
    {/* D27-255: People and security moved into the Settings console
        (people.settings.ts); each old address goes there (MEMORY 375). */}
    <Route path="/admin/roles" element={<Navigate to="/settings/people/roles" replace />} />
    <Route path="/admin/audit-log" element={<Navigate to="/settings/people/audit-log" replace />} />
    <Route path="/admin/activity" element={<Navigate to="/settings/people/activity" replace />} />
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
    {/* THE SETTINGS CONSOLE (D27-249): /settings/<group>/<slug>, its own
        space. Asked as "/settings" whichever page, then each page's own rule
        (pages/Settings.tsx). Its old addresses land there too. */}
    <Route
      path="/settings/*"
      element={
        <RequireAccess path="/settings" resource="setting">
          <SettingsPage />
        </RequireAccess>
      }
    />
    {/* With the hotel in the address (D27-216): the group owner's bell links to
        the hotel whose bank details changed, whichever one is open. The top
        bar takes the hotel, then the console opens the tab's page. */}
    <Route
      path="/h/:code/settings/:tab"
      element={
        <RequireAccess path="/settings" resource="setting">
          <PropertyScope /><SettingsForHotel />
        </RequireAccess>
      }
    />
    <Route
      path="/h/:code/setup"
      element={
        <RequireAccess path="/settings" resource="setting">
          <PropertyScope /><SetupForHotel />
        </RequireAccess>
      }
    />
    {/* D27-398: Backfill data for the Accountant, who reads it and has no
        Settings (nav.ts). The same page; the server says it is read-only. */}
    <Route path="/h/:code/backfill" element={<><PropertyScope /><BackfillForHotel /></>} />
    {/* Two screens Settings replaced: their addresses open the console.
        Configuration was where the refusals sent people to set GST. */}
    <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
    <Route path="/admin/configuration" element={<Navigate to="/settings/rates/taxes" replace />} />
  </>
);
