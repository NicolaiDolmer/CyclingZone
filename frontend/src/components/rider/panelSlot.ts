import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// #8069 T02 (ejer 16/11): ÉN fyldt guld-knap pr. visning paa rytterprofilen.
// Handlingsrækkens formularer (forlæng, sælg, auktion, tilbud, byt) har hver en
// guld-afsendeknap. Derfor er hoejst EN formular aaben ad gangen, og en guld-
// trigger (Forlæng, Giv tilbud) bliver sekundær, saa snart en formular er aaben:
// saa er formularens afsendeknap sidens ene guld-knap.
export type PanelSlot = { active: string | null; setActive: (key: string | null) => void };

export const PanelSlotContext = createContext<PanelSlot | null>(null);

export function usePanelSlotState(): PanelSlot {
  const [active, setActive] = useState<string | null>(null);
  return { active, setActive };
}

/** Er en formular i handlingsrækken aaben? (styrer guld-triggeres variant) */
export function useAnyPanelOpen(): boolean {
  const slot = useContext(PanelSlotContext);
  return Boolean(slot?.active);
}

/**
 * useState-erstatning for en formulars aaben-tilstand. Aabnes den, lukkes de
 * andre; uden en PanelSlotContext opfoerer den sig som almindelig useState.
 */
export function useExclusivePanel(key: string, initial = false): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const slot = useContext(PanelSlotContext);
  const active = slot ? slot.active : null;
  const setActive = slot ? slot.setActive : null;
  const [open, setOpenRaw] = useState(initial);

  // Aaben fra start (fx ?sell=1): meld formularen som den aktive.
  useEffect(() => {
    if (initial && setActive) setActive(key);
  }, [initial, setActive, key]);

  // En anden formular blev aabnet: luk denne.
  useEffect(() => {
    if (open && active && active !== key) setOpenRaw(false);
  }, [open, active, key]);

  // Stabil setter (refs): kaldes ogsaa fra effekter, der nulstiller ved rytterskift.
  const openRef = useRef(open);
  const activeRef = useRef(active);
  useEffect(() => { openRef.current = open; activeRef.current = active; });

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(openRef.current) : next;
    openRef.current = value;
    setOpenRaw(value);
    if (setActive) {
      if (value) setActive(key);
      else if (activeRef.current === key) setActive(null);
    }
  }, [setActive, key]);

  return [open, setOpen];
}
