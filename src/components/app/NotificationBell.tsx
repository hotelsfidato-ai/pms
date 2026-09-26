import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { notificationsRepo } from "@/data/repositories";
import { relative } from "@/lib/format";
import {
  Button, Drawer, DrawerContent, DrawerTrigger, StatusPill,
  EmptyState, Skeleton, type Tone,
} from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATION BELL
   Drawer-based notifications panel. Uses the repositories seam.
   ══════════════════════════════════════════════════════════════════ */

const CATEGORY_TONES: Record<string, Tone> = {
  approval: "warning",
  reservation: "info",
  payment: "danger",
  automation: "accent",
  customer: "info",
  system: "neutral",
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const hotelId = useUi((s) => s.hotelId);

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications", hotelId],
    queryFn: () => notificationsRepo.list(hotelId),
  });

  const unread = notifications?.filter((n) => !n.isRead).length ?? 0;

  const markAll = useMutation({
    mutationFn: () => notificationsRepo.markAllRead(hotelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", hotelId] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => notificationsRepo.markRead(hotelId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", hotelId] }),
  });

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          type="button"
          /* 44 on touch, 36 on the desktop console. It was p-2 — 34px —
             on every width. */
          className="relative size-11 lg:size-9 grid place-items-center rounded-md text-grey-500 hover:bg-grey-100 hover:text-ink-900 transition-colors duration-150"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-brand-orange-600 text-white text-2xs leading-4 font-semibold tabular ring-2 ring-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DrawerTrigger>

      <DrawerContent
        padded={false}
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : "You are all caught up"}
        footer={
          unread > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => markAll.mutate()}
              loading={markAll.isPending}
              leadingIcon={<CheckCheck className="size-4" />}
            >
              Mark all as read
            </Button>
          )
        }
      >
        {isLoading ? (
          <div className="p-5 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : !notifications?.length ? (
          <EmptyState
            icon={<Bell />}
            title="No notifications"
            description="Approvals, arrivals and payment alerts will appear here."
          />
        ) : (
          <ul className="divide-y divide-grey-100">
            {notifications.map((n) => {
              const body = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={cn(
                        "text-base leading-snug",
                        n.isRead ? "text-grey-600" : "text-ink-900 font-medium",
                      )}
                    >
                      {n.title}
                    </p>
                    {!n.isRead && (
                      <span className="size-1.5 rounded-full bg-brand-orange shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-sm text-grey-500 mt-1 leading-snug">{n.body}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <StatusPill tone={CATEGORY_TONES[n.category] ?? "neutral"} dot={false}>
                      {n.category}
                    </StatusPill>
                    <span className="text-2xs text-grey-500">{relative(n.at)}</span>
                  </div>
                </>
              );

              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link
                      to={n.link}
                      onClick={() => !n.isRead && markOne.mutate(n.id)}
                      className={cn(
                        "block px-5 py-3.5 transition-colors duration-150 hover:bg-grey-50",
                        !n.isRead && "bg-brand-orange-50/40",
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cn("px-5 py-3.5", !n.isRead && "bg-brand-orange-50/40")}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DrawerContent>
    </Drawer>
  );
}