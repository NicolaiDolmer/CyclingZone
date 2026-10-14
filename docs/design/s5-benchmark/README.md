# S5-benchmark: Grand Tour-etaper 2021-2025

Data-filen ligger i [`backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json`](../../../backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json), ikke her. Benchmark-gaten (`backend/lib/s5BenchmarkGate.js`) læser den på alle backend-skrivestier, og Railway bygger kun `backend/`, så filen skal ligge derinde (#6367).

Indhold: alle 315 etaper fra Tour de France, Giro d'Italia og Vuelta a España 2021-2025, klassificeret 12/10 med ejerens regler (spec [`2026-10-12-s5-etapeprofiler-design.md`](../../superpowers/specs/2026-10-12-s5-etapeprofiler-design.md), før regelrettelserne på kort 5).

Pr. etape: løb, år, etape, km, terræn, afslutning, brostens- og grussektorer, `gap10_s` (tid fra vinder til nr. 10; 0 = samme tid; null = neutraliseret/aflyst), kilde.

Kilder: ProCyclingStats-etapesider (distance, KOM-kategorier og -km, gradient sidste km, gap10) og cyclingstage.com-rutesider (stigningslængder, finalegeometri, sektorer).

Kendte usikkerheder (fra klassifikationen): 25 grænsetilfælde for afslutning (mur/bakke, nedkørsel 5-25 km-vinduet), stigningslængder er cyclingstage's tal, og brostens-/grussektorer er talt fra ruteprosa, ikke en officiel sektorliste. Brug fordelingerne og medianerne, ikke enkeltetaper, som facit.
