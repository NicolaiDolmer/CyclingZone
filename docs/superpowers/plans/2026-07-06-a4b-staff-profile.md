# A4b — Staff-profil-side + abilities-UI + admin-only test-gate (Implementeringsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levér den bruger-vendte del af det rige staff-system (#2220/#1441 A4): en `/staff/:id`-profil-side der spejler rytterprofilen, klikbar staff, kandidat-sammenligning, sæson-omkostnings-stribe — plus en admin-only test-gate så ejeren kan teste HELE faciliteter/staff-featuren på prod uden at almindelige brugere ser den.

**Architecture:** Backend-siden er lille: (1) migrér flag-konstanten `FACILITIES_ENABLED` → `app_config.facilities_enabled` (default false) og gate = `flag ELLER requester-er-admin`, resolvet i api.js-rutelaget og trådet ind i de eksisterende `{ flags }`-parametre; (2) eksponér `staff.id` + en server-beregnet `seasonCost`-blok i `GET /api/club/facilities`. Frontend spejler rytterprofil-mønsteret 1:1 (hero + switcher + tabs + ability-kolonner) men med staff-abilities-shapen `{overall, dimensions, levels, roleSkills}` (IKKE rytterens 15-evne-skema). Klub-fladen får klikbar staff, kandidat-sammenligning og en omkostnings-stribe.

**Tech Stack:** React + Vite (frontend), Node.js + Express + Supabase (backend), react-i18next (EN-først/DA-under), `node --test` (backend + frontend unit), Playwright (smoke). Design: cz-tokens + Bebas + `statColor`-SSOT, editorial anti-slop.

**Effekt-model/harness:** RØRES IKKE. A4-backenden ændrede effekt-modellen (ability-drevet) + rating-løn og blev harness-valideret grøn (`facilityInvestmentScorecard`/`inflationScorecard`, ±15%, 2807/2807). A4b tilføjer kun UI + flag-gating + read-eksponering af eksisterende felter → ingen ny økonomi-harness, kun backend contract-tests + frontend unit/smoke.

**Branch/PR:** Bygges på `feat/1441-staff-a4b` (branchet fra `feat/1441-staff-richness-a4`, som er rebased rent på main). **PR-anbefaling:** ÉN samlet PR `feat/1441-staff-a4b → main` der bærer hele A4-eposet (backend + frontend + begge migrationer), fordi A4 endnu ikke har en PR og begge dele er ejer-merge (migrationer). Alternativ (to stacked PRs) giver ekstra merge-koreografi for solo-ejer. **Migration + flag = ejer-merge; flip IKKE selv.**

---

## Filstruktur

**Backend (opret/modificér):**
- Opret: `database/2026-07-06-facilities-app-config-flag.sql` — seeder `app_config.facilities_enabled=false`.
- Modificér: `backend/lib/facilityRoutesHandlers.js` — `getClubFacilitiesHandler` tilføjer `staff.id` + `seasonCost`-blok.
- Modificér: `backend/routes/api.js` — de 6 `/club/*`-ruter resolver `facilitiesEnabled = flag || admin` og tråder det ind i handler-`flags`.
- Test: `backend/lib/facilityRoutesHandlers.test.js` (findes) — nye cases for `id`, `seasonCost`, admin-gate.
- Test: `backend/routes/facilityAdminGate.routes.test.js` (opret) — source-contract-test at ruterne resolver flag||admin.

**Frontend — staff-profil-side (opret):**
- `frontend/src/pages/StaffProfilePage.jsx` — side-orkestrator (fetch, states, switcher, tabs).
- `frontend/src/components/staff/profile/StaffProfileHero.jsx` — hero.
- `frontend/src/components/staff/profile/StaffSwitcherBar.jsx` — ‹ forrige · HOLD · rolle · næste ›.
- `frontend/src/components/staff/profile/StaffProfileTabs.jsx` — tab-bar.
- `frontend/src/components/staff/profile/StaffAbilityColumns.jsx` — evne-kolonner (dimensions/levels/roleSkills).
- `frontend/src/lib/staffAbilities.js` — frontend-SSOT: kolonne-definitioner + akse-nøgler + `topStaffAxis()` + `staffSpecializationHeadline()`.
- `frontend/src/lib/useStaffProfile.js` — hook: fetch `/api/club/staff/:id` + hold-roster til switcher.

**Frontend — Klub-integration (modificér):**
- `frontend/src/lib/useFacilities.js` — bevar `staff.id` + `seasonCost` fra svaret (data-drevet, sandsynligvis ingen ændring nødvendig — verificér pass-through).
- `frontend/src/components/klub/StaffPanel.jsx` — klikbar hired-staff-navn + kandidat-sammenligning (overall + specialisering).
- `frontend/src/components/klub/FacilityTrackCard.jsx` — klikbar hired-staff-navn.
- `frontend/src/pages/KlubPage.jsx` — sæson-omkostnings-stribe.
- `frontend/src/App.jsx` — rute `staff/:id`.

**i18n (opret/modificér):**
- Opret: `frontend/public/locales/en/staff.json` + `frontend/public/locales/da/staff.json` — profil-side-namespace.
- Modificér: `frontend/public/locales/{en,da}/klub.json` — nye nøgler (kandidat-sammenligning, omkostnings-stribe).
- Test: `frontend/src/components/staff/profile/StaffProfilePage.i18n.test.js` (opret).

**Docs (modificér ved close-out):**
- `frontend/src/pages/PatchNotesPage.jsx`, `frontend/public/locales/{en,da}/help.json`, `docs/NOW.md`.

---

## Fælles reference-shapes (brug præcist disse felter i alle tasks)

**`GET /api/club/facilities` svar (efter Task 2):**
```js
{
  facilities: [
    { track, tier, upgradePrice, tierUpkeep,
      staff: { id, name, tier, salary, overall } | null,   // id NYT i Task 2
      effectiveBonus, effectLive }
  ],
  seasonCost: { totalUpkeep, totalPayroll, balance }        // NYT i Task 2
}
```

**`GET /api/club/staff/:id` svar (findes, uændret):**
```js
{
  role,      // "training"|"scouting"|"medical"|"academy"|"commercial"
  tier,      // 1-5
  salary,    // heltal (CZ$/sæson)
  name,      // string
  abilities: {
    overall,                                  // 1-99
    dimensions: { physical?, mental?, technical? },   // kun training udfyldt
    levels:     { youth?, junior?, senior? },          // alle roller
    roleSkills: { /* scouting:{evaluation,reach} medical:{recovery,injuryPrevention}
                     academy:{intake,growth} commercial:{negotiation,marketing} training:{} */ }
  }
}
```

**Delte helpers (genbrug uændret):** `frontend/src/lib/statColor.js` → `statColor(v)`, `statTextColor(v)`. `frontend/src/components/ui/icons/IconBase.jsx`. Mønster-kilder at kopiere: `frontend/src/components/rider/profile/RiderProfileHero.jsx` (`RatingCircle` intern helper, PhotoPlaceholder), `RiderSwitcherBar.jsx`, `RiderProfileTabs.jsx`, `RiderAbilityColumns.jsx`.

---

## Task 1: Admin-only test-gate (flag-migration + rute-resolution)

**Files:**
- Create: `database/2026-07-06-facilities-app-config-flag.sql`
- Modify: `backend/routes/api.js` (de 6 `/club/*`-ruter, linjer ~7043-7115; admin-helper `isViewerAdmin` findes linje ~564; `readFlagStage`/`evaluateFlagStage` importeres fra `../lib/featureStage.js`)
- Test: `backend/routes/facilityAdminGate.routes.test.js` (source-contract)

- [ ] **Step 1: Skriv migrationen**

```sql
-- database/2026-07-06-facilities-app-config-flag.sql
-- A4b (#2220/#1441): migrér FACILITIES_ENABLED (kode-konstant) → app_config-flag.
-- Gate i backend bliver `flag === true/"on" ELLER requester er admin`, så ejeren
-- kan teste HELE faciliteter/staff-featuren på prod mens almindelige brugere
-- intet ser indtil flaget flippes. Default false. Idempotent.
-- Flip til live: UPDATE app_config SET value='true'::jsonb WHERE key='facilities_enabled';
INSERT INTO public.app_config (key, value, description)
VALUES ('facilities_enabled', 'false'::jsonb,
  'Feature flag for faciliteter/staff-systemet (#1441 A4). false = kun admins ser /klub + /staff (preview på prod). true/"on" = live for alle. Refs #2220.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Skriv den fejlende source-contract-test**

Konventionen for api.js-ruter er source-contract-tests (api.js er ikke unit-testbar; se `backend/routes/loanAmountValidation.routes.test.js` + `facilityRoutes.test.js`). Testen læser api.js-kildeteksten og asserterer at hver `/club/*`-rute resolver flag||admin og tråder det ind i handleren.

```js
// backend/routes/facilityAdminGate.routes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "api.js"), "utf8");

test("facility-ruter resolver facilitiesEnabled fra flag ELLER admin", () => {
  // Der findes en delt resolver der kombinerer app_config-flaget med admin-status.
  assert.match(api, /readFlagStage\(\s*supabase\s*,\s*["']facilities_enabled["']\s*\)/,
    "ruterne skal læse app_config-nøglen 'facilities_enabled'");
  assert.match(api, /isViewerAdmin\(req\)/,
    "gaten skal bypasse for admins via isViewerAdmin");
  assert.match(api, /resolveFacilitiesEnabled/,
    "en delt helper resolveFacilitiesEnabled(req) skal bære logikken (DRY over 6 ruter)");
});

test("alle 6 /club/-ruter tråder flags ind i handleren", () => {
  // Ingen /club/-rute må kalde en facility-handler UDEN { flags }-argument.
  const clubHandlerCalls = api.match(/\b(getClubFacilitiesHandler|postFacilityUpgradeHandler|getStaffCandidatesHandler|postStaffHireHandler|postStaffFireHandler|getStaffProfileHandler)\([^)]*\)/g) || [];
  assert.ok(clubHandlerCalls.length >= 6, "forventede mindst 6 handler-kald");
  for (const call of clubHandlerCalls) {
    assert.match(call, /flags/, `handler-kald mangler flags: ${call}`);
  }
});
```

- [ ] **Step 3: Kør testen — verificér FAIL**

Run: `cd backend && node --test --import ./test-setup.js routes/facilityAdminGate.routes.test.js`
Expected: FAIL (api.js har endnu ikke `resolveFacilitiesEnabled`/`readFlagStage("facilities_enabled")`; handler-kald mangler `flags`).

- [ ] **Step 4: Implementér — tilføj resolver + opdatér de 6 ruter i api.js**

Verificér først at `isViewerAdmin` findes (linje ~564) og at `featureStage.js` er importeret. Hvis `readFlagStage`/`evaluateFlagStage` ikke allerede importeres i api.js, tilføj: `import { readFlagStage, evaluateFlagStage } from "../lib/featureStage.js";` (matchende eksisterende import-stil — tjek om andre flags allerede importerer den).

Tilføj en delt resolver nær de øvrige facility-ruter:

```js
// A4b (#2220): faciliteter/staff er admin-synlige på prod FØR flip. Gate =
// app_config-flaget ('facilities_enabled' true/"on") ELLER requester er admin.
// Så ejeren tester end-to-end med ægte data; almindelige brugere får 403 →
// frontend viser tom-state indtil flaget flippes.
async function resolveFacilitiesEnabled(req) {
  const stage = await readFlagStage(supabase, "facilities_enabled");
  if (evaluateFlagStage(stage)) return true;
  return await isViewerAdmin(req);
}
```

Opdatér HVER af de 6 `/club/*`-ruter til at resolve og tråde `flags`. Eksempel (GET facilities):

```js
router.get("/club/facilities", requireAuth, async (req, res) => {
  try {
    if (!req.team?.id) return res.status(404).json({ error: "No team" });
    const facilitiesEnabled = await resolveFacilitiesEnabled(req);
    const { status, body } = await getClubFacilitiesHandler(
      { teamId: req.team.id }, supabase, { flags: { facilitiesEnabled } }
    );
    res.status(status).json(body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

Gør det samme for `/club/facilities/upgrade`, `/club/staff/candidates`, `/club/staff/hire`, `/club/staff/fire`, `/club/staff/:id` — hver resolver `facilitiesEnabled` og sender `{ flags: { facilitiesEnabled } }` (bevar eksisterende ekstra opts som `purchaseFacilityUpgrade`/`hireStaff`-injektion hvis de bruges). Handlerne accepterer allerede `{ flags }` (se `facilityRoutesHandlers.js`), så intet i handler-laget ændres for gaten.

- [ ] **Step 5: Kør testen — verificér PASS**

Run: `cd backend && node --test --import ./test-setup.js routes/facilityAdminGate.routes.test.js`
Expected: PASS.

- [ ] **Step 6: Kør hele backend-suiten (regression)**

Run: `cd backend && npm test 2>&1 | tail -8`
Expected: `pass 2807+` (ny test lægger til), `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add database/2026-07-06-facilities-app-config-flag.sql backend/routes/api.js backend/routes/facilityAdminGate.routes.test.js
git commit -F .git/COMMITMSG   # se meddelelse nedenfor (brug Write→fil + -F, aldrig heredoc)
```
Commit-meddelelse: `feat(club): admin-only test-gate — facilities_enabled app_config-flag + admin-bypass (#2220 A4b) [ejer-merge]`

---

## Task 2: Eksponér staff.id + seasonCost i GET /api/club/facilities

**Files:**
- Modify: `backend/lib/facilityRoutesHandlers.js` (`getClubFacilitiesHandler`, linjer 44-91)
- Test: `backend/lib/facilityRoutesHandlers.test.js` (findes — tilføj cases)

- [ ] **Step 1: Skriv de fejlende tests**

Find de eksisterende `getClubFacilitiesHandler`-tests i `facilityRoutesHandlers.test.js` og tilføj (matchende deres mock-stub-mønster — de bruger et fake supabase-objekt der returnerer `team_facilities`/`team_staff`/`teams`-rows):

```js
test("getClubFacilitiesHandler eksponerer staff.id til dyb-link", async () => {
  const supa = makeSupabaseStub({
    facilities: [{ track: "training", tier: 2 }],
    staff: [{ id: "staff-uuid-1", name: "M. Vand", role: "training", tier: 2, salary: 250 }],
    balance: 500000,
  });
  const { status, body } = await getClubFacilitiesHandler({ teamId: "t1" }, supa, { flags: { facilitiesEnabled: true } });
  assert.equal(status, 200);
  const training = body.facilities.find((f) => f.track === "training");
  assert.equal(training.staff.id, "staff-uuid-1");
});

test("getClubFacilitiesHandler returnerer seasonCost (upkeep + payroll + balance)", async () => {
  const supa = makeSupabaseStub({
    facilities: [{ track: "training", tier: 2 }, { track: "medical", tier: 1 }],
    staff: [{ id: "s1", name: "A", role: "training", tier: 2, salary: 250 }],
    balance: 500000,
  });
  const { body } = await getClubFacilitiesHandler({ teamId: "t1" }, supa, { flags: { facilitiesEnabled: true } });
  assert.ok(body.seasonCost, "seasonCost mangler");
  assert.equal(typeof body.seasonCost.totalUpkeep, "number");
  assert.equal(body.seasonCost.totalPayroll, 250);
  assert.equal(body.seasonCost.balance, 500000);
});
```

Hvis den eksisterende testfil ikke har en `makeSupabaseStub` der dækker `teams.balance`, udvid stubben så `.from("teams").select("balance").eq("id",...).maybeSingle()` returnerer `{ data: { balance }, error: null }`. Følg den PRÆCISE stub-form der allerede bruges i filen (læs den først).

- [ ] **Step 2: Kør — verificér FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/facilityRoutesHandlers.test.js`
Expected: FAIL (`staff.id` undefined; `seasonCost` undefined).

- [ ] **Step 3: Implementér i `getClubFacilitiesHandler`**

(a) Tilføj `id` til staff-SELECT (linje 55) og til `staffOut` (linje 69-76):

```js
    .select("id, name, role, tier, salary")   // + id
...
    const staffOut = staff
      ? {
          id: staff.id,                        // NYT: til /staff/:id dyb-link
          name: staff.name,
          tier: staff.tier,
          salary: staff.salary,
          overall: deriveStaffAbilities({ role: staff.role, tier: staff.tier, name: staff.name }).overall,
        }
      : null;
```

(b) Læs holdets saldo + beregn `seasonCost` før `return`:

```js
  const { data: teamRow, error: teamErr } = await supabaseClient
    .from("teams").select("balance").eq("id", teamId).maybeSingle();
  if (teamErr) throw new Error(`facilityRoutes: could not load balance for ${teamId}: ${teamErr.message}`);

  const totalUpkeep = facilities.reduce((sum, f) => sum + (f.tierUpkeep ?? 0), 0);
  const totalPayroll = (staffRows ?? []).reduce((sum, s) => sum + (s.salary ?? 0), 0);
  const seasonCost = { totalUpkeep, totalPayroll, balance: teamRow?.balance ?? 0 };

  return { status: 200, body: { facilities, seasonCost } };
```

Bekræft `teams`-tabellens saldo-kolonne HEDDER `balance` (grep `select("balance")` eller `.balance` i backend for at verificere kolonnenavnet før du skriver det — hvis den hedder noget andet, brug det rigtige navn).

- [ ] **Step 4: Kør — verificér PASS + hele filen grøn**

Run: `cd backend && node --test --import ./test-setup.js lib/facilityRoutesHandlers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit-meddelelse: `feat(club): eksponér staff.id + seasonCost i facilities-svar (#2220 A4b)`

---

## Task 3: Rute + StaffProfilePage-skelet (fetch + states + hook)

**Files:**
- Create: `frontend/src/lib/useStaffProfile.js`
- Create: `frontend/src/pages/StaffProfilePage.jsx`
- Modify: `frontend/src/App.jsx` (tilføj rute nær rider-ruten, ~linje 224)

- [ ] **Step 1: Skriv `useStaffProfile`-hooken**

Spejler rytter-fetch-mønsteret (Supabase-auth-token → fetch backend-endpoint) men enklere (ingen realtime). Læs hvordan et eksisterende hook henter en auth'et backend-rute (fx `useFacilities.js` bruger `authedFetch`/token-mønster — GENBRUG samme util). Hooken returnerer `{ profile, roster, loading, status }` hvor `status ∈ {"ok","forbidden","notfound","error"}`.

```js
// frontend/src/lib/useStaffProfile.js
import { useState, useEffect } from "react";
import { useFacilities } from "./useFacilities.js";
// GENBRUG samme fetch-util som useFacilities (læs dens import — fx apiFetch/authedFetch).
import { apiFetch } from "./api.js"; // ← ERSTAT med den faktiske util useFacilities bruger

export function useStaffProfile(staffId) {
  const facs = useFacilities();               // giver roster (facilities[].staff) til switcher
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    apiFetch(`/api/club/staff/${staffId}`)
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 403) return setStatus("forbidden");
        if (res.status === 404) return setStatus("notfound");
        if (!res.ok) return setStatus("error");
        const body = await res.json();
        setProfile(body);
        setStatus("ok");
      })
      .catch(() => alive && setStatus("error"));
    return () => { alive = false; };
  }, [staffId]);

  // Roster = holdets 5 staff (til ‹ forrige · næste ›), i TRACK_ORDER, kun besatte.
  const roster = (facs.facilities || [])
    .map((f) => f.staff && { id: f.staff.id, role: f.track, name: f.staff.name })
    .filter(Boolean);

  return { profile, roster, status, facilitiesLoading: facs.loading };
}
```

**VIGTIG:** Verificér den faktiske fetch-util ved at læse toppen af `useFacilities.js` (agent-rapport siger den håndterer 403 selv) og brug PRÆCIST samme util + auth-header-mønster. Ret importen ovenfor.

- [ ] **Step 2: Skriv StaffProfilePage-skelettet (states først)**

```jsx
// frontend/src/pages/StaffProfilePage.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState, PageLoader } from "../components/ui";
import { useStaffProfile } from "../lib/useStaffProfile.js";

export default function StaffProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("staff");
  const { profile, roster, status, facilitiesLoading } = useStaffProfile(id);

  if (status === "loading" || facilitiesLoading) return <PageLoader />;
  if (status === "forbidden") return <EmptyState title={t("gate.title")} description={t("gate.description")} />;
  if (status === "notfound" || status === "error" || !profile)
    return <EmptyState title={t("missing.title")} description={t("missing.description")} />;

  // Tabs + hero indsættes i Task 4-7. Skelet-render for nu:
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button type="button" onClick={() => navigate(-1)} className="text-[12px] text-cz-2 mb-3">
        ‹ {t("back")}
      </button>
      {/* <StaffSwitcherBar/> <StaffProfileHero/> <StaffProfileTabs/> ... */}
      <div data-testid="staff-profile-root">{profile.name}</div>
    </div>
  );
}
```

- [ ] **Step 3: Registrér ruten i App.jsx**

Ved siden af rider-ruten (`<Route path="riders/:id" .../>`, ~linje 224). Match lazy/direkte import-mønsteret der bruges for andre sider (tjek om siderne lazy-loades):

```jsx
<Route path="staff/:id" element={<StaffProfilePage />} />
```

Tilføj importen øverst i samme stil som `RiderStatsPage`.

- [ ] **Step 4: Verificér build + rute-render**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: build OK, ingen ubrugte-import-fejl.
(Fuld visuel verifikation sker i Task 12 via preview.)

- [ ] **Step 5: Commit**

Commit-meddelelse: `feat(staff): /staff/:id-rute + profil-side-skelet + useStaffProfile (#2220 A4b)`

---

## Task 4: StaffProfileHero

**Files:**
- Create: `frontend/src/components/staff/profile/StaffProfileHero.jsx`
- Reference (kopiér mønster): `frontend/src/components/rider/profile/RiderProfileHero.jsx` (PhotoPlaceholder + intern `RatingCircle`)

- [ ] **Step 1: Skriv heroen**

Kopiér `RatingCircle` + `PhotoPlaceholder`-mønsteret fra RiderProfileHero (samme klasser/tokens), men staff-felterne. Specialiserings-headline: brug `staffSpecializationHeadline(profile)` fra `lib/staffAbilities.js` (Task 5). Props: `{ profile }` (fra `/staff/:id`-svaret).

```jsx
// frontend/src/components/staff/profile/StaffProfileHero.jsx
import { useTranslation } from "react-i18next";
import { statColor, statTextColor } from "../../../lib/statColor.js";
import { staffSpecializationHeadline } from "../../../lib/staffAbilities.js";

function RatingCircle({ rating, label }) {
  const has = Number.isFinite(rating) && rating > 0;
  const bg = has ? statColor(rating) : "var(--bg-subtle)";
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className="rounded-full w-16 h-16 flex items-center justify-center font-mono font-bold text-[28px]"
        style={{ backgroundColor: bg, color: statTextColor(rating) }}>
        {has ? rating : "—"}
      </div>
      <span className="text-cz-3 text-[10px] uppercase tracking-wide">{label}</span>
    </div>
  );
}

function PhotoPlaceholder({ name }) {
  const initials = (name || "").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-[70px] h-[92px] flex flex-col items-center justify-center bg-cz-subtle border border-cz-border rounded-cz text-cz-3">
      <span className="font-display text-2xl leading-none">{initials || "?"}</span>
      <span className="text-[9px] uppercase tracking-[1.5px] mt-1">{"FOTO"}</span>
    </div>
  );
}

export default function StaffProfileHero({ profile }) {
  const { t } = useTranslation("staff");
  const overall = profile?.abilities?.overall ?? null;
  const headline = staffSpecializationHeadline(profile, t);
  return (
    <div className="border-t-2 border-cz-accent pt-3 flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-3">
        <PhotoPlaceholder name={profile.name} />
        <div>
          <h1 className="font-display uppercase leading-none [font-size:clamp(30px,4.4vw,44px)]">{profile.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-cz-2 flex-wrap">
            <span className="px-2 py-[2px] rounded-cz-pill bg-cz-subtle">{t(`roles.${profile.role}`)}</span>
            <span>{t("hero.tier", { tier: profile.tier })}</span>
            <span>{t("hero.salary", { amount: profile.salary })}</span>
          </div>
          {headline && <p className="text-[12px] text-cz-1 mt-2">{headline}</p>}
        </div>
      </div>
      <div className="hidden sm:block border border-cz-border rounded-cz p-3">
        <RatingCircle rating={overall} label={t("hero.ratingEyebrow")} />
      </div>
    </div>
  );
}
```

**Note:** `roles.*`-nøglerne findes i `klub`-namespace; dupliker dem i `staff`-namespace (Task 11) eller brug `useTranslation("klub")` for rolle-labels. Vælg ét (anbefaling: dupliker i `staff.json` for selvstændighed).

- [ ] **Step 2: Verificér build** — `cd frontend && npm run build 2>&1 | tail -3` → OK.
- [ ] **Step 3: Commit** — `feat(staff): StaffProfileHero (foto/navn/rating/specialisering) (#2220 A4b)`

---

## Task 5: StaffAbilityColumns + lib/staffAbilities.js (frontend-SSOT)

**Files:**
- Create: `frontend/src/lib/staffAbilities.js`
- Create: `frontend/src/components/staff/profile/StaffAbilityColumns.jsx`
- Reference: `RiderAbilityColumns.jsx` (kolonne-grid + AbilityRow-mønster), `lib/statColor.js`

- [ ] **Step 1: Skriv frontend-SSOT `lib/staffAbilities.js`**

Definér kolonner pr. rolle (spejler spec §1.2). Kolonnerne trækkes fra `abilities`-shapen: `dimensions` (training), `levels` (alle), `roleSkills` (ikke-training). Akse-labels via i18n-nøgler.

```js
// frontend/src/lib/staffAbilities.js
// Frontend-SSOT for staff-evne-visning (#2220 A4b). Spejler lib/abilities.js for
// ryttere, men staff-shapen er { overall, dimensions, levels, roleSkills }.
// Kolonner pr. rolle (spec §1.2). i18n-nøgler under staff:axes.*.

// Nøgle-lister pr. gruppe. axisKey → i18n-nøgle staff:axes.<axisKey>.
export const STAFF_LEVEL_KEYS = ["youth", "junior", "senior"];
export const STAFF_DIMENSION_KEYS = ["physical", "mental", "technical"];
export const STAFF_ROLE_SKILL_KEYS = {
  training: [],
  scouting: ["evaluation", "reach"],
  medical: ["recovery", "injuryPrevention"],
  academy: ["intake", "growth"],
  commercial: ["negotiation", "marketing"],
};

// Returnér kolonne-definitioner for en rolle: [{ key, axisKeys, source }]
// source = hvilket abilities-underobjekt værdierne læses fra.
export function staffColumnsFor(role) {
  const cols = [];
  if (role === "training") {
    cols.push({ key: "dimensions", axisKeys: STAFF_DIMENSION_KEYS, source: "dimensions" });
  } else if ((STAFF_ROLE_SKILL_KEYS[role] || []).length) {
    cols.push({ key: "roleSkills", axisKeys: STAFF_ROLE_SKILL_KEYS[role], source: "roleSkills" });
  }
  cols.push({ key: "levels", axisKeys: STAFF_LEVEL_KEYS, source: "levels" });
  return cols;
}

// Højest-scorende akse på tværs af dimensions+levels+roleSkills → {axisKey, value} | null.
export function topStaffAxis(profile) {
  const ab = profile?.abilities;
  if (!ab) return null;
  const entries = [
    ...Object.entries(ab.dimensions || {}),
    ...Object.entries(ab.levels || {}),
    ...Object.entries(ab.roleSkills || {}),
  ].filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { axisKey: entries[0][0], value: entries[0][1] };
}

// "Bedst til fysisk træning" o.l. — t er en i18n t() bundet til staff-namespace.
export function staffSpecializationHeadline(profile, t) {
  const top = topStaffAxis(profile);
  if (!top) return null;
  return t("hero.specHeadline", { axis: t(`axes.${top.axisKey}`) });
}
```

- [ ] **Step 2: Skriv StaffAbilityColumns**

Genbrug AbilityRow-mønsteret (navn + tal via statColor; INGEN progress-bar for staff — statiske evner, spec §8). Kort-header med Bebas + 2px guld-underline som rytter.

```jsx
// frontend/src/components/staff/profile/StaffAbilityColumns.jsx
import { useTranslation } from "react-i18next";
import { statColor } from "../../../lib/statColor.js";
import { staffColumnsFor } from "../../../lib/staffAbilities.js";

function AbilityRow({ label, value }) {
  return (
    <div className="flex items-center gap-[9px] py-[3.5px]">
      <span className="flex-1 min-w-0 text-[11.5px] text-cz-2 truncate">{label}</span>
      <span className="font-mono tabular-nums font-bold text-[12.5px] text-right flex-none min-w-[19px]"
        style={{ color: statColor(value) }}>
        {Number.isFinite(value) ? value : "—"}
      </span>
    </div>
  );
}

export default function StaffAbilityColumns({ profile }) {
  const { t } = useTranslation("staff");
  const cols = staffColumnsFor(profile.role);
  const ab = profile.abilities || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px] items-start">
      {cols.map((col) => (
        <div key={col.key} className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
          <div className="flex items-center gap-2 pb-2 mb-1 border-b-2 border-cz-accent/50">
            <h3 className="font-display text-base leading-none tracking-[0.03em] uppercase text-cz-1 m-0">
              {t(`columns.${col.key}`)}
            </h3>
            <span className="font-mono text-[9.5px] text-cz-3 ms-auto">{col.axisKeys.length}</span>
          </div>
          {col.axisKeys.map((axis) => (
            <AbilityRow key={axis} label={t(`axes.${axis}`)} value={ab[col.source]?.[axis]} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verificér build** → OK.
- [ ] **Step 4: Commit** — `feat(staff): StaffAbilityColumns + staffAbilities-SSOT (#2220 A4b)`

---

## Task 6: StaffProfileTabs + tab-indhold + kobl heroen ind i siden

**Files:**
- Create: `frontend/src/components/staff/profile/StaffProfileTabs.jsx`
- Modify: `frontend/src/pages/StaffProfilePage.jsx` (indsæt hero + tabs + tab-indhold)
- Reference: `RiderProfileTabs.jsx`

- [ ] **Step 1: Skriv tab-baren** (3 tabs: overview/effect/history — spec §3)

```jsx
// frontend/src/components/staff/profile/StaffProfileTabs.jsx
import { useTranslation } from "react-i18next";
const TABS = ["overview", "effect", "history"];
export default function StaffProfileTabs({ active, onChange }) {
  const { t } = useTranslation("staff");
  return (
    <div className="sticky top-0 z-10 bg-cz-body flex gap-4 border-b border-cz-border mb-4">
      {TABS.map((tab) => (
        <button key={tab} type="button" onClick={() => onChange(tab)}
          className={`py-2 text-[13px] uppercase tracking-wide border-b-2 -mb-px ${
            active === tab ? "border-cz-accent text-cz-1" : "border-transparent text-cz-3"}`}>
          {t(`tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Kobl hero + tabs + indhold ind i StaffProfilePage**

Erstat skelet-render fra Task 3 med (bevar states-guards):

```jsx
  // øverst i komponenten (efter guards):
  const [tab, setTab] = useState("overview");
  const overall = profile.abilities?.overall;
  // ...
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button type="button" onClick={() => navigate(-1)} className="text-[12px] text-cz-2 mb-3">‹ {t("back")}</button>
      <StaffSwitcherBar current={id} roster={roster} onNavigate={(sid) => navigate(`/staff/${sid}`)} />
      <StaffProfileHero profile={profile} />
      <StaffProfileTabs active={tab} onChange={setTab} />
      {tab === "overview" && <StaffAbilityColumns profile={profile} />}
      {tab === "effect" && (
        <p className="text-[13px] text-cz-2 max-w-prose">
          {t("effect.body", { rating: overall })}
        </p>
      )}
      {tab === "history" && (
        <p className="text-[13px] text-cz-2">{t("history.body")}</p>
      )}
    </div>
  );
```

Tilføj de nødvendige imports (`useState`, `StaffSwitcherBar`, `StaffProfileHero`, `StaffProfileTabs`, `StaffAbilityColumns`). **Effekt-tab-tekst** skal være ærlig om at kun training-effekten er live (spec §1.2/§8, samme `effectLive`-ærlighed som A3) — se i18n-nøglen `effect.body` i Task 11.

- [ ] **Step 3: Verificér build** → OK.
- [ ] **Step 4: Commit** — `feat(staff): tabs + overview/effect/history-indhold koblet i profil-siden (#2220 A4b)`

---

## Task 7: StaffSwitcherBar

**Files:**
- Create: `frontend/src/components/staff/profile/StaffSwitcherBar.jsx`
- Reference: `RiderSwitcherBar.jsx` (keyboard ← →, sticky, disabled-states)

- [ ] **Step 1: Skriv switcher-baren** (‹ forrige · HOLD · rolle · næste › over holdets besatte staff)

```jsx
// frontend/src/components/staff/profile/StaffSwitcherBar.jsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function StaffSwitcherBar({ current, roster, onNavigate }) {
  const { t } = useTranslation("staff");
  const idx = roster.findIndex((r) => r.id === current);
  const prev = idx > 0 ? roster[idx - 1] : null;
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && prev) onNavigate(prev.id);
      if (e.key === "ArrowRight" && next) onNavigate(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onNavigate]);

  if (roster.length <= 1) return null;
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between py-2 text-[12px] text-cz-2">
      <button type="button" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}
        className={`${prev ? "text-cz-1" : "opacity-30"}`}>
        ‹ {prev ? t(`roles.${prev.role}`) : ""}
      </button>
      <span className="uppercase tracking-wide text-cz-3">{t("switcher.count", { index: idx + 1, total: roster.length })}</span>
      <button type="button" disabled={!next} onClick={() => next && onNavigate(next.id)}
        className={`${next ? "text-cz-1" : "opacity-30"}`}>
        {next ? t(`roles.${next.role}`) : ""} ›
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificér build** → OK.
- [ ] **Step 3: Commit** — `feat(staff): StaffSwitcherBar (‹ forrige · rolle · næste ›, keyboard-nav) (#2220 A4b)`

---

## Task 8: Klikbar staff i StaffPanel + FacilityTrackCard

**Files:**
- Modify: `frontend/src/components/klub/StaffPanel.jsx` (hired-staff-navn → Link)
- Modify: `frontend/src/components/klub/FacilityTrackCard.jsx` (hired-staff-navn → Link)

- [ ] **Step 1: StaffPanel — gør hired-staff-navn klikbart**

`facility.staff.id` er nu i data (Task 2). Wrap navnet i `<Link to={`/staff/${staff.id}`}>`. Importér `Link` fra `react-router-dom`. Bevar `onClose`-kald så modalen lukker ved navigation:

```jsx
import { Link } from "react-router-dom";
// ...i hired-blokken, erstat plain {staff.name} med:
<Link to={`/staff/${staff.id}`} onClick={onClose}
  className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">
  {staff.name}
</Link>
```

- [ ] **Step 2: FacilityTrackCard — samme**

Hired-staff-linjen (agent: linje 37-41) — wrap `{staff.name}` i `<Link to={`/staff/${staff.id}`}>`. `facility.staff.id` er tilgængeligt.

- [ ] **Step 3: Verificér build** → OK.
- [ ] **Step 4: Commit** — `feat(klub): klikbar hired-staff → /staff/:id (StaffPanel + FacilityTrackCard) (#2220 A4b)`

---

## Task 9: Kandidat-sammenligning i StaffPanel (overall + specialisering)

**Files:**
- Modify: `frontend/src/components/klub/StaffPanel.jsx` (kandidat-liste, agent: linje 71-79)

- [ ] **Step 1: Vis overall + topSpecialization pr. kandidat**

Kandidat-objektet har allerede `overall` + `topSpecialization` (A4-backend). Udvid kandidat-rækken med et lille rating-tal (statColor) + specialiserings-label. `topSpecialization` er en akse-nøgle (fx `"physical"`, `"evaluation"`) → oversæt via `staff:axes.*` (importér `useTranslation("staff")` i tillæg, eller tilføj nøglerne til klub-namespace — anbefaling: brug `staff`-namespace for akse-labels for at undgå dublering).

```jsx
import { statColor } from "../../lib/statColor.js";
// t2 = useTranslation("staff").t (til akse-labels)
{candidates.map((c) => (
  <div key={c.name} className="rounded-cz border border-cz-border bg-cz-card px-[14px] py-[9px] flex justify-between items-center gap-3">
    <div className="min-w-0">
      <div className="text-[13px] truncate">{c.name}</div>
      <div className="text-[11px] text-cz-2">
        {t("staff.candidate", { tier: c.tier, amount: formatNumber(c.salary) })}
        {c.topSpecialization && <> · {t2(`axes.${c.topSpecialization}`)}</>}
      </div>
    </div>
    <div className="flex items-center gap-3">
      <span className="font-mono tabular-nums font-bold text-[13px]" style={{ color: statColor(c.overall) }}>
        {c.overall}
      </span>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => doHire(c.name)}>
        {t("staff.hire")}
      </Button>
    </div>
  </div>
))}
```

- [ ] **Step 2: Verificér build** → OK.
- [ ] **Step 3: Commit** — `feat(klub): kandidat-sammenligning viser overall + specialisering (#2220 A4b)`

---

## Task 10: Sæson-omkostnings-stribe på KlubPage

**Files:**
- Modify: `frontend/src/pages/KlubPage.jsx`

- [ ] **Step 1: Render striben fra `facs.seasonCost`**

`useFacilities` returnerer nu `seasonCost` (data-drevet pass-through; hvis hooken kun plukker `facilities`, udvid den til også at eksponere `seasonCost` — læs `useFacilities.js` og tilføj `seasonCost` til dens returnerede objekt). Indsæt en stribe under facilitets-grid'et (før StaffPanel):

```jsx
{facs.seasonCost && (
  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] border-t border-cz-border pt-3">
    <span className="text-cz-2">{t("cost.upkeep")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.totalUpkeep)}</span></span>
    <span className="text-cz-2">{t("cost.payroll")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.totalPayroll)}</span></span>
    <span className="text-cz-2 ms-auto">{t("cost.balance")}: <span className="font-mono text-cz-1">{formatNumber(facs.seasonCost.balance)}</span></span>
  </div>
)}
```

- [ ] **Step 2: Verificér build** → OK.
- [ ] **Step 3: Commit** — `feat(klub): sæson-omkostnings-stribe (upkeep + payroll vs. saldo) (#2220 A4b)`

---

## Task 11: i18n (en + da) + i18n-test

**Files:**
- Create: `frontend/public/locales/en/staff.json`, `frontend/public/locales/da/staff.json`
- Modify: `frontend/public/locales/en/klub.json`, `frontend/public/locales/da/klub.json`
- Modify: i18n-namespace-registrering (find hvor namespaces listes — fx `frontend/src/i18n.js` `ns: [...]` — tilføj `"staff"`)
- Create: `frontend/src/components/staff/profile/StaffProfilePage.i18n.test.js`

- [ ] **Step 1: Opret `en/staff.json`** (EN-først)

```json
{
  "back": "Back",
  "gate": { "title": "Not available yet", "description": "The staff area isn't open yet." },
  "missing": { "title": "Staff not found", "description": "This chief isn't on your team." },
  "roles": { "training": "Sports Director", "scouting": "Chief Scout", "medical": "Team Doctor", "academy": "Academy Director", "commercial": "Commercial Director" },
  "hero": { "tier": "Tier {{tier}}", "salary": "{{amount}} CZ$/season", "ratingEyebrow": "Rating /99", "specHeadline": "Best at {{axis}}" },
  "tabs": { "overview": "Overview", "effect": "Effect", "history": "History" },
  "columns": { "dimensions": "Coaching", "levels": "Level focus", "roleSkills": "Role skills" },
  "axes": {
    "physical": "physical training", "mental": "mental training", "technical": "technical training",
    "youth": "youth", "junior": "junior", "senior": "senior",
    "evaluation": "talent evaluation", "reach": "network reach",
    "recovery": "recovery", "injuryPrevention": "injury prevention",
    "intake": "intake quality", "growth": "growth rate",
    "negotiation": "negotiation", "marketing": "marketing"
  },
  "effect": { "body": "This chief's overall rating ({{rating}}) drives how much of the facility's effect is realised. Only the training track's effect is live today; the others show their target and activate as each engine lands." },
  "history": { "body": "Contract history and tenure will appear here once staff contracts land." },
  "switcher": { "count": "{{index}} / {{total}}" }
}
```

- [ ] **Step 2: Opret `da/staff.json`** (samme nøgler, dansk)

```json
{
  "back": "Tilbage",
  "gate": { "title": "Ikke tilgængelig endnu", "description": "Staff-området er ikke åbnet endnu." },
  "missing": { "title": "Staff ikke fundet", "description": "Denne chef er ikke på dit hold." },
  "roles": { "training": "Sportsdirektør", "scouting": "Chefscout", "medical": "Holdlæge", "academy": "Akademichef", "commercial": "Kommerciel direktør" },
  "hero": { "tier": "Tier {{tier}}", "salary": "{{amount}} CZ$/sæson", "ratingEyebrow": "Rating /99", "specHeadline": "Bedst til {{axis}}" },
  "tabs": { "overview": "Overblik", "effect": "Effekt", "history": "Historik" },
  "columns": { "dimensions": "Coaching", "levels": "Niveau-fokus", "roleSkills": "Rolle-evner" },
  "axes": {
    "physical": "fysisk træning", "mental": "mental træning", "technical": "teknisk træning",
    "youth": "ungdom", "junior": "junior", "senior": "senior",
    "evaluation": "talentvurdering", "reach": "netværk",
    "recovery": "restitution", "injuryPrevention": "skadesforebyggelse",
    "intake": "intake-kvalitet", "growth": "vækstfart",
    "negotiation": "forhandling", "marketing": "marketing"
  },
  "effect": { "body": "Chefens samlede rating ({{rating}}) afgør hvor stor en del af facilitetens effekt der realiseres. Kun trænings-sporet har live effekt i dag; de øvrige viser deres mål og aktiveres når hver motor lander." },
  "history": { "body": "Kontrakt-historik og anciennitet vises her når staff-kontrakter lander." },
  "switcher": { "count": "{{index}} / {{total}}" }
}
```

- [ ] **Step 3: Tilføj klub-nøgler** (kandidat-sammenligning + omkostnings-stribe) til BEGGE klub.json:

en/klub.json — tilføj under `cost` (ny blok):
```json
  "cost": { "upkeep": "Upkeep", "payroll": "Payroll", "balance": "Balance" }
```
da/klub.json:
```json
  "cost": { "upkeep": "Drift", "payroll": "Lønninger", "balance": "Saldo" }
```

- [ ] **Step 4: Registrér `staff`-namespace**

Find i18n-init (fx `frontend/src/i18n.js`) og tilføj `"staff"` til `ns`-listen (og evt. preload). Uden dette loader `useTranslation("staff")` ikke nøglerne. Verificér mønsteret ved at se hvordan `"klub"`/`"rider"` er registreret.

- [ ] **Step 5: Skriv i18n-parity-test** (spejler eksisterende `*.i18n.test.js`)

```js
// frontend/src/components/staff/profile/StaffProfilePage.i18n.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const en = JSON.parse(readFileSync(join(root, "public/locales/en/staff.json"), "utf8"));
const da = JSON.parse(readFileSync(join(root, "public/locales/da/staff.json"), "utf8"));

function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
test("en/da staff.json har identiske nøgler", () => {
  assert.deepEqual(keys(en).sort(), keys(da).sort());
});
```

- [ ] **Step 6: Kør frontend-tests**

Run: `cd frontend && node --test 2>&1 | tail -8`
Expected: pass, fail 0.

- [ ] **Step 7: Commit** — `feat(i18n): staff-namespace (en+da) + klub cost-nøgler + parity-test (#2220 A4b)`

---

## Task 12: Verifikation (lokal preflight + preview) + docs + close-out

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/public/locales/{en,da}/help.json`
- Modify: `docs/NOW.md` (close-out)

- [ ] **Step 1: Fuld lokal preflight (obligatorisk før push)**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests grønne (2807+), frontend-tests grønne, frontend-build OK.

- [ ] **Step 2: Lint (CI-only gate)**

Run: `cd frontend && npm run lint 2>&1 | tail -15`
Expected: 0 errors (react-hooks/purity). Ret evt. warnings inden for budget.

- [ ] **Step 3: Playwright smoke (alle 3 projekter)**

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Expected: pass på desktop-chromium + mobile-chromium + mobile-webkit.

- [ ] **Step 4: Preview-verifikation (admin-gate + profil-side)**

Start preview med mock (`VITE_PREVIEW_MOCK`) ELLER lokal dev-server. Udvid preview-mocken med de nye staff-shapes (`abilities.dimensions/levels/roleSkills`, `staff.id`, `seasonCost`) hvis den mangler dem, så flowet kan klikkes: Klub → klik hired-staff → `/staff/:id` → tabs. Tag RIGTIGE screenshots (mobil + desktop) af (a) Klub-fladen med omkostnings-stribe + kandidat-sammenligning, (b) staff-profil-siden. **Vedhæft dem i PR'en** (ejeren ser ikke Read-billed-output; Playwright-mock-screenshots ses kun af Claude — brug preview_screenshot og host dem).

- [ ] **Step 5: Patch notes + help**

Tilføj en patch-note-post (ny version) i `PatchNotesPage.jsx` der beskriver staff-profiler + klikbar staff + kandidat-sammenligning (player-facing; men featuren er admin-gated → formulér ærligt eller vent til flip). **Beslutning:** da featuren er admin-gated indtil flip, skriv patch-noten men markér den til at følge flip'et (samme mønster som A3's stagede patch-note `docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md` — udvid den draft frem for en live note nu). Opdatér `help.json` (en+da) tilsvarende eller notér hvorfor ikke (afventer flip).

- [ ] **Step 6: Samlet commit + push + PR**

```bash
git add -A
git commit -F <msg-fil>   # "docs: patch-note-draft + help for A4b staff-profiler (#2220)"
git push -u origin feat/1441-staff-a4b
```
Opret ÉN PR `feat/1441-staff-a4b → main` med PULL_REQUEST_TEMPLATE (inkl. Brugerverifikation-sektion + screenshots). Body noterer: **migration + flag = ejer-merge; flip ikke foretaget**. `Refs #2220 #2216 #1441`.

- [ ] **Step 7: Close-out**

Opdatér `docs/NOW.md` (🎯 Next action + 🤖 Working agent → "Ingen aktiv session"). Kør `pwsh -File scripts/check-agent-token-hygiene.ps1`. Kommentér #2220 med status + PR-link (ejeren merger migrationen).

---

## Self-review (writing-plans)

**Spec-dækning (§6 A4b-scope):** (1) /staff/:id-profil-side → Task 3-7 ✓. (2) klikbar staff → Task 8 ✓. (3) kandidat-sammenligning → Task 9 ✓. (4) sæson-omkostnings-stribe → Task 10 ✓. (5) admin-only-gate (FACILITIES_ENABLED→app_config, flag||admin) → Task 1 ✓. (6) preview/test-flow → Task 12 Step 4 ✓. Ability-UI (dimensions/levels/roleSkills) → Task 5 ✓. Specialiserings-headline → Task 4+5 ✓. Effekt-model/harness urørt (bevidst) ✓.

**Placeholder-scan:** Tre steder kræver kilde-verifikation FØR kodning (markeret i tasks): (a) Task 3 — den præcise fetch-util `useFacilities` bruger (ret importen); (b) Task 2 — `teams`-saldo-kolonnenavn (`balance`?); (c) Task 11 Step 4 — hvor i18n-namespaces registreres. Disse er "verificér-i-repo", ikke uspecificeret logik. Ingen TBD/TODO i selve implementeringen.

**Type-konsistens:** `staff.id` (Task 2) → forbruges Task 8. `seasonCost.{totalUpkeep,totalPayroll,balance}` (Task 2) → forbruges Task 10. `abilities.{dimensions,levels,roleSkills}` (fælles-shape) → forbruges Task 5 (`staffColumnsFor`/`col.source`). `topSpecialization` (A4-backend) → Task 9. `staffSpecializationHeadline(profile, t)` defineret Task 5 → kaldt Task 4. `roster:[{id,role,name}]` (Task 3) → forbruges Task 7. i18n-nøgler `axes.*`/`roles.*`/`columns.*`/`tabs.*` defineret Task 11 → refereret Task 4-9. Konsistent.
