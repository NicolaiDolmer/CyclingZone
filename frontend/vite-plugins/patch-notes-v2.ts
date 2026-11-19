// #8049 · Vite-plugin: den nye patch notes-side henter små filer i stedet for hele
// changelog'en. SSOT er stadig src/data/patchNotes.js; alt her genereres i build og
// committes aldrig.
//
// Pr. sprog (en, da; manglende sprog falder tilbage som i dag):
//   patch-notes-data/recent.<lang>.json   de seneste 6 uger + listen over arkivmåneder
//   patch-notes-data/index.<lang>.json    titler på alt ældre (søgning i arkivet)
//   patch-notes-data/<YYYY-MM>.<lang>.json én fil pr. arkivmåned
// Siden henter kun recent ved åbning; index ved første søgning; en måned når den åbnes.
// Den gamle patch-notes.json udsendes uændret af patch-notes-json.js, så kontakten
// patch_notes_v2_8049 slukket er den gamle side bit for bit.
//
// Kun spillervendte noter (audience "player") kommer med. Teksten røres ikke: et punkt
// er notens titel og tekst på det valgte sprog, plus område (lib/patchNotesArea.ts),
// mærke-felter og en seenKey (dato + løbenummer inden for dagen) til "Nyt siden sidst".
import path from "node:path";
import type { Plugin } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveArea, resolveImage } from "../src/lib/patchNotesArea.ts";
import { PATCH_NOTES_DATA_DIR, weekStartOf, addDaysIso, pickLang } from "../src/lib/patchNotes.js";

interface ChangeText { title?: string; body?: string }
interface PatchChange {
  category?: string; audience?: string; rollout?: string; stage?: string; flag?: string; topic?: string;
  area?: unknown; image?: unknown; highlight?: unknown; replaces?: unknown; en?: ChangeText; da?: ChangeText;
}
interface PatchEntry { version: string; date: string; changes?: PatchChange[] }
/** Et punkt i filerne (kompakte nøgler, se lib/patchNotes.js). */
export interface PatchItem {
  k: string; v: string; d: string; s: string; a: string; c?: string; ti: string; b: string;
  r?: string; f?: string; fb?: string; img?: string; hl?: boolean; rp?: string;
}

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(PLUGIN_DIR, "..", "src", "data", "patchNotes.js");
export const PATCH_NOTES_V2_LANGS = Object.freeze(["en", "da"]);
/** Denne uge + 5 forrige: "Denne uge", "Sidste uge" og 4 tidligere uger har altid deres tekst. */
export const RECENT_WEEKS = 6;

function compareVersion(a: string, b: string): number {
  const A = String(a).split(".").map(Number);
  const B = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d;
  }
  return 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * seenKey pr. version: datoen + versionens løbenummer inden for dagen skrevet som
 * klokkeslæt (dagens 3. version = "2026-11-16T00:03"). Passer i markør-mønsteret i
 * backend/lib/seenMarkers6515.js og sammenlignes som streng, så "Nyt siden sidst"
 * også fanger en note der lander senere samme dag, uden backend-ændring.
 */
export function buildSeenKeys(patches: PatchEntry[]): Map<string, string> {
  const byDate = new Map<string, string[]>();
  for (const p of patches || []) {
    if (!p?.date) continue;
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date)?.push(p.version);
  }
  const keys = new Map<string, string>();
  for (const [date, versions] of byDate) {
    versions.sort(compareVersion).forEach((v, i) => {
      const n = Math.min(i + 1, 23 * 60 + 59);
      keys.set(v, `${date}T${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`);
    });
  }
  return keys;
}

/** seenKey for den nyeste version (bruges også i patch-notes-meta.json til menuens prik). */
export function latestSeenKeyOf(patches: PatchEntry[]): string | null {
  let best: string | null = null;
  for (const key of buildSeenKeys(patches).values()) if (!best || key > best) best = key;
  return best;
}

/** Alle spillervendte ændringer som kompakte punkter på ét sprog, nyeste først. */
export function buildItems(patches: PatchEntry[], lang: string): PatchItem[] {
  const seenKeys = buildSeenKeys(patches);
  const items: PatchItem[] = [];
  for (const p of patches || []) {
    (p.changes || []).forEach((c, i) => {
      if (c.audience !== "player") return;
      const k = `${p.version}#${i}`;
      const text = pickLang(c, lang);
      const item: PatchItem = {
        k,
        v: p.version,
        d: p.date,
        s: seenKeys.get(p.version) || p.date,
        a: resolveArea(c, k),
        c: c.category,
        ti: text.title || "",
        b: text.body || "",
      };
      const rollout = c.rollout || (c.stage === "beta" ? "beta" : null);
      if (rollout && rollout !== "live") item.r = rollout;
      if (c.flag) item.f = c.flag;
      if (text.isFallback) item.fb = text.lang;
      const img = resolveImage(c, k);
      if (img) item.img = img;
      if (c.highlight === true) item.hl = true;
      if (typeof c.replaces === "string") item.rp = c.replaces;
      items.push(item);
    });
  }
  items.sort((x, y) => (x.s !== y.s ? (x.s < y.s ? 1 : -1) : compareVersion(y.v, x.v) || (x.k < y.k ? 1 : -1)));
  return items;
}

/**
 * Filerne for ét sprog. `latest` = nyeste dato i data; vinduet regnes fra den uge.
 * Returnerer { [filnavn under patch-notes-data/]: objekt }.
 */
export function buildLangFiles(patches: PatchEntry[], lang: string): Record<string, any> {
  const items = buildItems(patches, lang);
  const latest = items[0]?.d || null;
  const recentStart = latest ? addDaysIso(weekStartOf(latest), -7 * (RECENT_WEEKS - 1)) : null;
  const recent = recentStart ? items.filter((it) => it.d >= recentStart) : [];
  const older = recentStart ? items.filter((it) => it.d < recentStart) : items;

  const monthCounts = new Map<string, number>();
  const byMonth = new Map<string, PatchItem[]>();
  for (const it of items) {
    const m = it.d.slice(0, 7);
    monthCounts.set(m, (monthCounts.get(m) || 0) + 1);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)?.push(it);
  }
  const months = [...monthCounts.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([m, n]) => ({ m, n }));

  const files: Record<string, unknown> = {
    [`recent.${lang}.json`]: {
      latest,
      recentStart,
      seenKey: latestSeenKeyOf(patches),
      months,
      items: recent,
    },
    [`index.${lang}.json`]: {
      // Kun det der ikke allerede ligger i recent: titel, dato, område og mærke-felter.
      items: older.map(({ k, d, a, c, r, f, ti, fb }) => {
        const row: Partial<PatchItem> = { k, d, a, c, ti };
        if (r) row.r = r;
        if (f) row.f = f;
        if (fb) row.fb = fb;
        return row;
      }),
    },
  };
  for (const [m, list] of byMonth) files[`${m}.${lang}.json`] = { month: m, items: list };
  return files;
}

/** Alle filer for alle sprog: { "patch-notes-data/<navn>": JSON-streng }. */
export function buildPatchNotesV2Files(patches: PatchEntry[], langs: readonly string[] = PATCH_NOTES_V2_LANGS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of langs) {
    for (const [name, value] of Object.entries(buildLangFiles(patches, lang))) {
      out[`${PATCH_NOTES_DATA_DIR}/${name}`] = JSON.stringify(value);
    }
  }
  return out;
}

async function loadPatches(): Promise<PatchEntry[]> {
  const url = `${pathToFileURL(DATA_FILE).href}?t=${Date.now()}`;
  const mod = await import(url);
  if (!Array.isArray(mod.PATCHES)) throw new Error(`patch-notes-v2: PATCHES er ikke en array i ${DATA_FILE}`);
  return mod.PATCHES;
}

export function patchNotesV2Plugin(): Plugin {
  let isSsrBuild = false;
  return {
    name: "cz-patch-notes-v2",
    configResolved(config) {
      isSsrBuild = Boolean(config.build && config.build.ssr);
    },
    async generateBundle() {
      if (isSsrBuild) return;
      const files = buildPatchNotesV2Files(await loadPatches());
      for (const [fileName, source] of Object.entries(files)) this.emitFile({ type: "asset", fileName, source });
    },
    // dev + preview-server: server filerne fra hukommelsen.
    configureServer(server) {
      server.middlewares.use(`/${PATCH_NOTES_DATA_DIR}`, async (req, res, next) => {
        try {
          const name = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\//, "");
          const files = buildPatchNotesV2Files(await loadPatches());
          const source = files[`${PATCH_NOTES_DATA_DIR}/${name}`];
          if (!source) return next();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(source);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default patchNotesV2Plugin;
