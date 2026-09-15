import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { useUi } from "@/lib/ui";

/* Two small route pieces every service's screens use, moved out of App.tsx
   when the screen addresses moved into each service's own routes file
   (docs/SERVICE-FOLDERS-PLAN.md). Unchanged. */

/** Keeps the store in step with the property named in the URL. */
export function PropertyScope() {
  const { code } = useParams();
  const setHotelId = useUi((s) => s.setHotelId);
  useEffect(() => {
    if (code) setHotelId(code);
  }, [code, setHotelId]);
  return null;
}

/** Sends a bare `/h/:code` to that property's stay view. */
export function PropertyIndex() {
  const { code } = useParams();
  return <Navigate to={`/h/${code}/stay`} replace />;
}
