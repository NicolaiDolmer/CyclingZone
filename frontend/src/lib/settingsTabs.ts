// #5402: Indstillinger-siden (/profile, ProfilePage.jsx) er delt i faner i
// stedet for een lang scroll-side (ejer-direktiv 18/9). Ren modul uden React,
// saa fane-reglen kan testes med node --test uden at rendere komponenten
// (samme moenster som lib/teamProfileTabs.js).
//
// Fanen bor i URL'en (?tab=). Et dyb-link kan ogsaa pege paa en enkelt
// sektion med et anker (#discord, #beta ...): ankeret afgoer da fanen, og
// siden ruller sektionen ind i billedet. Et eksplicit ?tab= vinder altid over
// ankeret, saa et link aldrig lander paa en fane det ikke bad om.

export const SETTINGS_TABS = ["account", "notifications", "preferences", "privacy", "beta"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "account";

// Hver sektion (kort) paa siden og den fane den bor i. Raekkefoelgen inde i en
// fane er den samme som paa den gamle scroll-side.
export const SETTINGS_SECTION_TAB = {
  account: "account",
  team: "account",
  subscription: "account",
  "selection-reminder": "notifications",
  "forum-categories": "notifications",
  discord: "notifications",
  appearance: "preferences",
  assistant: "preferences",
  privacy: "privacy",
  beta: "beta",
} as const satisfies Record<string, SettingsTab>;

export type SettingsSection = keyof typeof SETTINGS_SECTION_TAB;

// DOM-id'et paa sektionens kort. Praefikset holder id'erne fri af resten af
// appen (et bart id="discord" kunne kollidere med andre flader).
export function settingsSectionId(section: SettingsSection): string {
  return `settings-${section}`;
}

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && (SETTINGS_TABS as readonly string[]).includes(value);
}

function sectionFromHash(hash: string | null | undefined): SettingsSection | null {
  if (!hash) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(hash.replace(/^#/, "")).replace(/^settings-/, "");
  } catch {
    return null; // et misdannet anker (fx et loest "%") er bare intet anker
  }
  return Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_TAB, raw) ? (raw as SettingsSection) : null;
}

export interface ResolvedSettingsTab {
  tab: SettingsTab;
  // Sektionen der skal rulles ind i billedet, eller null. Kun sat naar den
  // faktisk bor i den valgte fane.
  section: SettingsSection | null;
}

export function resolveSettingsTab(
  tabParam: string | null | undefined,
  hash?: string | null,
): ResolvedSettingsTab {
  const section = sectionFromHash(hash);
  if (isSettingsTab(tabParam)) {
    return { tab: tabParam, section: section && SETTINGS_SECTION_TAB[section] === tabParam ? section : null };
  }
  if (section) return { tab: SETTINGS_SECTION_TAB[section], section };
  return { tab: DEFAULT_SETTINGS_TAB, section: null };
}
