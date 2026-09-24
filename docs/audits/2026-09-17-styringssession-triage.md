# Styringssession 17/9 (kørsel 1): triage + PR-afgørelser

Rytme: `docs/WEEKLY_STEERING.md`. Målt ved start: 669 åbne, +105/-67 på 7 dage, 9 PR'er BLOCKED + 2 DIRTY.

## PR-afgørelser (alle 10 åbne)

| PR | Afgørelse | Status |
|---|---|---|
| #5324 netværksfejl-måling (#5312) | merge | ✅ merget 10:40 |
| #5308 rytterdatabase scout + filtre (#5292) | merge, F2 (menu-klik nulstiller) beholdt + patch note | ✅ merget |
| #5285 fair-play-rapporter i admin (#5284) | worker gjorde 3 checks grønne, merge | ✅ merget |
| #5281 B3 + #5264 B4 træning | merges sammen efter egen træningsdesign-session | B4 grøn + mergebar, venter |
| #5263 sponsor S4-priser | ejer vil tale om den senere | draft, venter |
| #5262 U23-katalog | draft; filter-spor i Bølge 4 først | venter på filter |
| #5235 mobiltabeller D-047 | worker gjorde grøn + screenshots | UI-kort udestår |
| #5169 140 løbsdage | dagsorden til træningsdesign-sessionen | parkeret |
| #3512 arketype | #5327 oprettet (3 trin, Bølge 4 m. #5269) | draft |

## Del A: ugens 109 nye issues (siden 10/9) pr. bane

🔴 brand 8 · Bane 1 17 · Bane 2 22 · Bane 3 56 · venteliste 1 · icebox-kandidat 5.

- **Brand:** #5323 #5312 #5322 #5242 #5162 #5222 #5256 #5325
- **Bane 1:** kalender #5267 #5272 · træning #5236 #5237 #5238 #5270 #5275 #5319 · ryttere #5105 #5268 #5269 #5273 #5283 #5288 #5327 · #5101 #5124
- **Bane 2:** marked/fair play #5107 #5136 #5203 #5225 #5226 #5246 #5257 #5259 #5282 #5284 #5320 · vækst #5104 #5130 #5131 #5177 #5249 #5296 #5304 #5305 #5306 #5310 · auth #5250
- **Bane 3:** spillerfund/bugs #5096 #5200 #5290 #5301 #5302 #5315 #5317 #5318 #5145 #5180 #5201 #5292 #5314 #5316 #5321 #5255 #5293 #5223 #5075 #5095 #5129 #5266 #5289 #5313 #5076 #5179 #5294 #5295 #5274 · visuel identitet #5113 #5114 #5115 #5116 #5117 #5118 #5119 #5120 · drift/CI #5085 #5088 #5091 #5092 #5093 #5094 #5151 #5152 #5157 #5218 #5219 #5224 #5243 #5253 #5271 #5286 #5291 #5309 #5326
- **Venteliste:** #5074 · **Icebox-kandidat:** #5087 #5106 #5156 #5227 #5307

## Del B: icebox-batch 1 (40 kandidater, priority:low, ikke i MASTERPLAN, ikke fejl/spillerfund/epic)

- drift/CI (12): #134 #886 #904 #2686 #2857 #3421 #4149 #4565 #4816 #4927 #4930 #4961
- marked (5): #17 #26 #986 #4825 #4958 · ryttere (5): #27 #3374 #3970 #4073 #4433 · løb (5): #1979 #2480 #2991 #3050 #3856
- vision (5): #94 #103 #1109 #1113 #5225 · UI (3): #1011 #1033 #3726 · vækst (3): #1888 #3487 #5227 · træning #1679 · kalender #2030
- usikre (3, ligner bugs): #2749 #2838 #4001

Anbefaling: icebox 38, #1109 + #1113 til venteliste "vision" (dækker roadmap-løfter), de 3 usikre får bug-label. **Ejer-go udestår.**

## Sandhedstjek

- **MASTERPLAN mod GitHub:** 17 lukkede issues stod uden ✅ (bl.a. #4872, #5182 i brand-blokken); 16 high-prio nye uden plads; 5 ✅-markerede stadig `claude:todo` (#3668 #5268 #4943 #4346 #2760). Rettet i MASTERPLAN 17/9.
- **GDD mod specs:** spec 11/9 (ryttertype/punch-loft) helt udækket; 15/9-specs har retning men ikke mekanik (H1-H6, L1-L3, U23 §10.1-10.5); NOW-regler uden D-nummer: Graduation Day 23, lofttal + aggression ude, 1 rytter = 1 løb pr. løbsdag. → spor i bølgen (Refs #5087).
- **Spillerløfter (23 aktive på roadmap-siden):** 2 uden plan (coaches/burnout, generational renewal); DM v1 er leveret men ikke markeret shipped og mangler i FEATURE_REGISTRY (hard rule 30e).
- **Budget:** AGENTS.md (6.717 tok) og FEATURE_STATUS.md (3.282 tok) FAIL; forslag i worker-rapport (flyt regel 9/34-prosa til AI_OPS_REFERENCE; kort `note`-felt i FEATURE_REGISTRY).
- **PUBLIC_ROADMAP.md** forældet (taler om "inden sæson 1"); erstattes af henvisning til roadmap-siden.

## Vækst (uge 38)

Signups/uge 32→19→18→17→12→20→6→6→2. Kanal 28d mod forrige 28d: Google 12/5, direkte 16/26, ChatGPT 2/7, Reddit 0/7, Hattrick 0/4. Udkast: `docs/drafts/growth-s4-launch-2026-09-17.md`. Infisical-login udløbet (mandagstal-script kunne ikke køre).
