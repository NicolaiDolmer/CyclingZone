import { useRef, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import { menuClass, menuItemClass } from "./menuStyles.js";

export function Menu({ className = "", children, ...rest }) {
  return (
    <div role="menu" className={`cz-menu-panel ${menuClass()} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function MenuItem({ active = false, danger = false, className = "", children, ...rest }) {
  return (
    <button type="button" role="menuitem" className={`${menuItemClass({ active, danger })} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// Ankret dropdown. `trigger` er en render-prop: ({ open, toggle }) => <button .../>
// (kalderen ejer trigger-stylingen + aria-expanded). `align` flugter panelet
// venstre/højre under trigger; `defaultOpen` til kitchen-sink/snapshot.
export function Dropdown({ trigger, children, align = "left", defaultOpen = false, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const toggle = () => setOpen((v) => !v);
  const alignCls = align === "right" ? "right-0" : "left-0";
  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      {trigger({ open, toggle })}
      {open && (
        <div className={`absolute z-dropdown mt-2 ${alignCls}`}>
          <Menu>{children}</Menu>
        </div>
      )}
    </div>
  );
}
