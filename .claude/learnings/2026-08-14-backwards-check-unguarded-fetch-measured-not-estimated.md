# Backwards-checket efter #3619: 214 fetch-kald gennemgået, 6 ægte fejl, 1 forward-guard

**Dato:** 2026-08-14 · **Issue:** [#3628](https://github.com/NicolaiDolmer/CyclingZone/issues/3628)
**Kæde:** [#2719](https://github.com/NicolaiDolmer/CyclingZone/issues/2719) → [#3619](https://github.com/NicolaiDolmer/CyclingZone/issues/3619) (CYCLINGZONE-4E) → dette

## Symptom (fejlklassen)

`fetch()` **rejecter** ved netværksudfald — mobil-WebKit kaster `TypeError: Load failed`.
Sker det i en handler der lige har sat en loading-tilstand:

```js
setSaving(true);
const res = await fetch(url, { method: "POST" });   // ← kaster
setSaving(false);                                   // ← kører ALDRIG
```

...bliver rejection'en unhandled, oprydningen springes over, og knappen står i
"Gemmer..." for evigt. Er den også `disabled={saving}` — det er den typisk — kan
spilleren hverken se fejlen eller prøve igen.

## Det egentlige fund: heuristikken i issuet var 3x for pessimistisk

Issuet meldte **48** mistænkte kaldesteder ud fra et regex-scan med 30 linjers
tilbageblik, og sagde selv at tallet ikke var et bug-antal. Et AST-scan
(`@babel/parser`, nærmeste omsluttende funktion, try-blok kontra catch/finally)
gav det målte tal:

| Måling | Antal |
|---|---|
| `await fetch(...)`-kaldesteder i `frontend/src` (ekskl. tests/preview) | 214 |
| ...allerede i en `try` | 192 |
| ...UDEN `try` | **22** (i 8 filer, 20 distinkte handler-funktioner) |

De 20 handlere fik hver en dom:

| Dom | Antal |
|---|---|
| Ægte — loading-tilstand der aldrig ryddes | **6** |
| Falsk positiv — kalderen fanger, verificeret kaldesteds-for-kaldesteds | 11 |
| Ægte fejlklasse, andet symptom — ingen loading-tilstand, så tavshed frem for fastlåst knap | 3 |

**Læringen:** et scan-tal i en issue-tekst er et *arbejdsemne*, ikke et resultat. Her
kostede det ét script at gå fra "48 mistænkte" til "22 kandidater, 6 fejl", og uden det
skridt ville PR-body'en have båret et tal der var forkert med faktor 8. Samme regel som
[[feedback_verify_numbers_from_specs_before_shipping]]: mål tallet før det bliver til en
påstand.

De 11 falske positiver var ikke gætværk — hvert kaldesteds kalder blev læst:
`riderContractActions.js` (8 kaldesteder i `RiderManageActions`/`TeamPage`, alle med
try/catch), `AdminForumTab.action()` (try/catch/finally), `ForumPostPage.submitReport`
(`ReportModal.handleSubmit` har try/catch/finally), og auktions-handlerne der dækkes af
`useAuctionBidding` siden #3619.

## De seks ægte

| Handler | Hvad spilleren så |
|---|---|
| `ProfilePage.toggleDmEnabled` | Discord-DM-toggle fast i gemmer-tilstand |
| `ProfilePage.toggleDmPref` | **Fladen løj**: optimistisk opdatering blev aldrig rullet tilbage |
| `ProfilePage.sendTestDm` | "Sender..." for evigt |
| `ProfilePage.saveTeamInfo` | Hold-/managernavn fast i "Gemmer..." |
| `RiderStatsPage` start-auktion | Knappen fast på "Starter...", og `disabled` → ingen vej ud |
| `BoardPage` bestyrelses-wizard | Trin 1 med spinner + permanent disabled "Start forhandling" |

De to sidste stod ikke i issuet — de blev fundet fordi auditet fulgte *kalderen* og ikke
kun fetch-linjen. `RiderStatsPage.startAuction` har selv ingen loading-tilstand; det er
`AuctionButton.submitAuction` der sætter og rydder flaget. En scanner der kun ser på
fetch-linjen kan ikke se den kobling — det kan et menneske der læser opad.

## To ting fetch-linjen ikke er alene om

Begge fandtes i alle seks handlere og ville have overlevet en snæver "wrap fetch'en"-kur:

1. `supabase.auth.getSession()` går **selv på nettet** når token'et skal fornyes. Står
   den før fetch'en men uden for try'en, kaster den lige så tavst.
2. `await res.json()` uden `.catch(() => ({}))` kaster på et non-JSON-svar (fx en 502 fra
   proxy'en) — samme udfald, anden årsag.

Kuren er derfor try om **hele handler-kroppen** med `finally` på loading-flaget, ikke en
try om fetch-kaldet.

## Forward-guard: hvorfor lint og ikke en wrapper

Issuet stillede to muligheder: en baseline-lint eller en delt `apiFetch()` der aldrig
kaster. Lint valgt (issuets egen anbefaling): den stopper blødningen nu og rører 0 af de
214 kaldesteder. Wrapperen er stadig den rigtige endestation, men er en separat
beslutning.

`scripts/lint-unguarded-fetch-in-handler.mjs` er en ratchet pr. fil, samme mønster som
`lint-swallowed-catches.mjs` / `lint-unchecked-supabase-mutation.mjs`. Baseline er de 16
tilbageværende — **ikke** en legitimering, men et loft der kun kan gå ned.

To designvalg der er værd at huske:

- Guarden flager også de kaldesteder hvor kalderen *faktisk* fanger. Det er med vilje:
  "kalderen fanger vel" var præcis antagelsen der fejlede i #3619, hvor siderne regnede
  med at hooket fangede og hooket regnede med at siderne gjorde. De ligger i baseline med
  en note om hvem der fanger, i stedet for at være usynlige.
- Scanneren er verificeret mod AST-scanneren: begge finder de **samme 16 sites på de
  samme linjenumre**. En regex-heuristik der ikke er krydstjekket mod en rigtig parser er
  en påstand, ikke en måling.

## Verificeret rød → grøn

- `frontend/src/lib/networkErrorGuards.test.js`: 8/8 fejler mod `origin/main`s kilder,
  8/8 grønne efter fixet.
- `lint-unguarded-fetch-in-handler.mjs` mod `origin/main`s `ProfilePage.jsx`: 4 fund
  (baseline 0 → CI rød). Efter fixet: 0.
