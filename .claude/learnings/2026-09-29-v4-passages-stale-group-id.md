# #5914: Passager brugte et forældet gruppe-id

- Problem: En rytter i et udbrud kunne blive vurderet som siddende i feltet ved en mellemspurt eller bjergtop.
- Rodårsag: RiderState.group_id sættes ved start og opdateres efter mål. Split og samlinger ændrer state.groups[].rider_ids under etapen.
- Kilde verificeret i backend/lib/engine/v4/mechanics/bonusSeconds.ts: liveGroupByRider bygger passagens aktuelle gruppeopslag fra gruppemedlemskabet.
- Rettelse leveret i PR #5958: passageordenen bruger den aktuelle gruppe og de godkendte konkurrerende roller/trøjeførere.
- Regressionerne i bonusSeconds.test.ts dækker stale group_id, udbrud foran feltet, roller og trøjeførere.
- Runtime 30/9: flad etape 5 i La Course au Soleil og kuperet etape 1 i Tour de la Somme er kontrolleret read-only. Alle 41 belønnede rækker matcher tidslinjens grupper og roller; en supplerende etape giver positivt bevis for pointfører-undtagelsen. Samlet 56 rækker uden afvigelser. Bevis: docs/snapshots/5952/2026-09-30-5914-runtime-verification.json.
- Læring: Et felt på RiderState er ikke en live-kilde, blot fordi det beskriver den samme entitet. Kontroller hvor og hvornår feltet vedligeholdes, og brug den kanoniske kilde for den aktuelle fase.
