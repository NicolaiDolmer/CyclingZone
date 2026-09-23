"use client";

// Login-/signup-link til app'en, der bærer de tilladte utm_*-parametre fra
// marketing-sidens URL med videre (#5310). Server-HTML'en har det rene link
// (siderne forbliver statiske og CDN-cachebare); efter hydrering tilføjes
// kampagnens UTM'er. useSyncExternalStore med en server-snapshot på "" giver en
// hydrerings-sikker første render uden setState-i-effect.

import { useSyncExternalStore, type ComponentProps } from "react";
import { withUtm } from "@/lib/attribution";

const subscribe = () => () => {};
const getSearch = () => window.location.search;
const getServerSearch = () => "";

export function AppLink({ href, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  return <a {...props} href={withUtm(href, search)} />;
}
