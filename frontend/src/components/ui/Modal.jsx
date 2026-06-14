import { forwardRef } from "react";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import Portal from "./Portal.jsx";
import { panelClass, backdropClass } from "./modalStyles.js";
import { XIcon } from "./icons/index.jsx";

// Presentational dialog-overflade. Genbruges af Modal (i portal) + kitchen-sink
// (statisk preview). Sætter IKKE selv role/aria-modal — det gør Modal paa ref'en.
export const DialogSurface = forwardRef(function DialogSurface(
  { title, titleId, description, footer, size = "md", onClose, closeLabel = "Close", className = "", children, ...rest },
  ref
) {
  return (
    <div ref={ref} className={`relative cz-overlay-panel ${panelClass({ size })} ${className}`} {...rest}>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-cz text-cz-3 transition-colors duration-150 hover:bg-cz-subtle hover:text-cz-1"
        >
          <XIcon size={18} />
        </button>
      )}
      {(title || description) && (
        <div className="border-b border-cz-border px-6 py-4 pe-12">
          {title && (
            <h2 id={titleId} className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
              {title}
            </h2>
          )}
          {description && <p className="mt-1.5 text-sm text-cz-2">{description}</p>}
        </div>
      )}
      <div className="px-6 py-5 text-sm text-cz-1">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 border-t border-cz-border px-6 py-4">{footer}</div>
      )}
    </div>
  );
});

export default function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  closeLabel = "Close",
  titleId = "cz-modal-title",
  children,
}) {
  const ref = useModalA11y(open ? onClose : null, Boolean(open));
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
        <div className={backdropClass()} aria-hidden="true" onClick={onClose} />
        <DialogSurface
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          title={title}
          titleId={titleId}
          description={description}
          footer={footer}
          size={size}
          onClose={onClose}
          closeLabel={closeLabel}
          className="outline-none"
        >
          {children}
        </DialogSurface>
      </div>
    </Portal>
  );
}
