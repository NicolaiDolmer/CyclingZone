import { createContext, useContext, useRef } from "react";
import { tabClass, tabListClass } from "./tabsStyles.js";

const TabsContext = createContext(null);

export function Tabs({ value, onChange, className = "", children }) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// #4625 (slice 3 af #4622) — WAI-ARIA tabs-mønsteret i fuld: Left/Right flytter
// ét tab, Home/End hopper til første/sidste (audit-krav "tastaturnavigation").
export function TabList({ label, className = "", children }) {
  const listRef = useRef(null);
  const onKeyDown = (e) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tabs = Array.from(listRef.current?.querySelectorAll('[role="tab"]') ?? []);
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : e.key === "ArrowRight" ? (i + 1) % tabs.length
      : (i - 1 + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={tabListClass({ className })}
    >
      {children}
    </div>
  );
}

export function Tab({ value: tabValue, className = "", children }) {
  const ctx = useContext(TabsContext);
  const active = ctx?.value === tabValue;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => ctx?.onChange?.(tabValue)}
      className={`${tabClass({ active })} ${className}`}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value: panelValue, className = "", children }) {
  const ctx = useContext(TabsContext);
  if (ctx?.value !== panelValue) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
