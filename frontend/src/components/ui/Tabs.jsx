import { createContext, useContext, useEffect, useRef } from "react";
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
  const ref = useRef(null);

  // #3200: fanerækken scroller vandret på mobil. Da Indbakken fik sin femte
  // fane, lå den aktive fane uden for skærmen på 390px når man kom ind via et
  // deep link — ingen understregning nogen steder, og fanen kunne kun findes
  // ved at gætte at rækken kunne skubbes.
  //
  // Kun VANDRET, og kun på selve tablisten. Den oplagte `scrollIntoView({
  // block: "nearest" })` blev prøvet først og rullede HELE siden nogle få
  // pixels, så den klistrede topbjælke forsvandt ud af billedet på mobil
  // (fanget af core-smoke's finance-snapshot). Et fane-skift må aldrig flytte
  // sidens lodrette position.
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const list = el?.closest('[role="tablist"]');
    if (!el || !list) return;
    if (list.scrollWidth <= list.clientWidth) return; // rækken kan ikke scrolle
    const pad = 16;
    const left = el.offsetLeft - list.offsetLeft;
    const right = left + el.offsetWidth;
    if (left - pad < list.scrollLeft) {
      list.scrollLeft = Math.max(0, left - pad);
    } else if (right + pad > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = right + pad - list.clientWidth;
    }
  }, [active]);

  return (
    <button
      ref={ref}
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
