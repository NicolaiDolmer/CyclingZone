import { useEffect } from "react";
import Portal from "./Portal.jsx";
import { toastClass } from "./toastStyles.js";
import { XIcon, InfoIcon, CheckIcon, AlertTriangleIcon } from "./icons/index.jsx";

const TONE_ICON = {
  info: InfoIcon,
  success: CheckIcon,
  danger: AlertTriangleIcon,
  warning: AlertTriangleIcon,
};

const TONE_ICON_COLOR = {
  info: "text-cz-info",
  success: "text-cz-success",
  danger: "text-cz-danger",
  warning: "text-cz-warning",
};

export function Toast({ tone = "info", title, description, onClose, closeLabel = "Close", className = "" }) {
  const Icon = TONE_ICON[tone] ?? InfoIcon;
  return (
    <div role="status" className={`cz-toast-item ${toastClass({ tone })} ${className}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${TONE_ICON_COLOR[tone] ?? TONE_ICON_COLOR.info}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-cz-1">{title}</p>
        {description && <p className="mt-0.5 text-xs text-cz-2">{description}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="-me-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-cz text-cz-3 transition-colors duration-150 hover:bg-cz-subtle hover:text-cz-1"
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

// Portaleret, positioneret stak med auto-dismiss. Controlled: kalderen ejer
// `toasts`-arrayet (hvert element: { id, tone?, title, description? }) og afviser
// via onDismiss(id). Konsoliderer OverbidToast-positioneringen.
export function ToastViewport({ toasts = [], onDismiss, duration = 4000 }) {
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((t) => setTimeout(() => onDismiss?.(t.id), duration));
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss, duration]);

  if (!toasts.length) return null;
  return (
    <Portal>
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed left-4 right-4 top-16 z-toast flex flex-col gap-2 md:bottom-4 md:left-auto md:right-4 md:top-auto md:max-w-sm"
      >
        {toasts.map((t) => (
          <Toast
            key={t.id}
            tone={t.tone}
            title={t.title}
            description={t.description}
            onClose={() => onDismiss?.(t.id)}
          />
        ))}
      </div>
    </Portal>
  );
}
