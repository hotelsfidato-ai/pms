import { useEffect } from "react";
import { create } from "zustand";
import { CheckCircle2, AlertCircle, Info, X, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   TOASTS
   In Phase 1 these also stand in for the side effects the platform
   will really have — sending email, generating a PDF, calling n8n.
   ══════════════════════════════════════════════════════════════════ */

export type ToastTone = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
  /** When it was last raised. A repeat of the same message moves this
      forward instead of adding a second card. */
  shownAt: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (
    toast: Omit<Toast, "id" | "duration" | "shownAt"> & { duration?: number },
  ) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: ({ duration = 4500, ...toast }) => {
    /* THE SAME MESSAGE TWICE IS NOT TWO PIECES OF NEWS.
       A refusal that cannot be satisfied gets pressed again, and again,
       and the screen fills with identical cards — the owner sent a
       screenshot of five stacked "Could not check out". Stacking makes
       a wall look like five walls, and it buries whatever else the
       screen was trying to say underneath them.

       An identical message still on screen is REFRESHED rather than
       repeated: it moves back to the top of its timer, so pressing
       again feels like the same answer rather than a new one. The id
       is returned as if it were new, because to the caller it is. */
    const key = `${toast.tone}|${toast.title}|${toast.description ?? ""}`;
    const existing = get().toasts.find(
      (t) => `${t.tone}|${t.title}|${t.description ?? ""}` === key);

    if (existing) {
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === existing.id ? { ...t, shownAt: Date.now() } : t),
      }));
      return existing.id;
    }

    const id = `toast-${++counter}`;
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id, duration, shownAt: Date.now() }],
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper so any handler can fire one without a hook. */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "error", title, description, duration: 6000 }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "info", title, description }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "warning", title, description }),
};

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-success" },
  error: { icon: AlertCircle, className: "text-brand-red" },
  warning: { icon: TriangleAlert, className: "text-brand-yellow" },
  info: { icon: Info, className: "text-info" },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { icon: Icon, className } = TONE_STYLES[t.tone];

  /* `shownAt` is in the dependencies deliberately. A repeated message
     refreshes it rather than adding a second card, and this is what
     makes the timer restart — without it the toast would vanish on the
     first press's clock while the reader was still reading it. */
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t.id, t.duration, t.shownAt, dismiss]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-3 p-3.5",
        "bg-white border border-grey-200 rounded-md shadow-overlay",
        "motion-toast",
      )}
    >
      <Icon className={cn("size-4 shrink-0 mt-0.5", className)} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-ink-900 leading-snug">{t.title}</p>
        {t.description && (
          <p className="text-sm text-grey-500 mt-0.5 leading-snug">{t.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Dismiss"
        className="text-grey-400 hover:text-ink-900 transition-colors duration-150 shrink-0"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
