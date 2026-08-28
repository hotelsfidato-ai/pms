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
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: ({ duration = 4500, ...toast }) => {
    const id = `toast-${++counter}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }] }));
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

  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t.id, t.duration, dismiss]);

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
