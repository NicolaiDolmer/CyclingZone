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

export function TabList({ label, className = "", children }) {
  const listRef = useRef(null);
  const onKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(listRef.current?.querySelectorAll('[role="tab"]') ?? []);
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={tabListClass({ className })}>
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
