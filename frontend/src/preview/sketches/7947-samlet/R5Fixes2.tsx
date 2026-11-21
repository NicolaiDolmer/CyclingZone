// #8476: foer/efter for rettelse 2-10 (se R5Fixes.tsx). Eksempeldata.
import type { ReactNode } from "react";

const LBL = "mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em]";

function Pair({ intro, before, after }: { intro: string; before: ReactNode; after: ReactNode }) {
  return (
    <>
      <p className="mt-1 max-w-[72ch] text-sm text-cz-2">{intro}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div><div className={`${LBL} text-cz-danger`}>Før (i dag)</div>{before}</div>
        <div><div className={`${LBL} text-cz-success`}>Efter</div>{after}</div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-cz border border-cz-border bg-cz-card p-4"><h3 className="mb-3 font-data text-base font-semibold text-cz-1">{title}</h3>{children}</section>;
}

function Chip({ t }: { t: string }) {
  return <span className="inline-flex items-center rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-xs text-cz-1">{t}</span>;
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-cz-2">{k}</dt><dd className="text-end font-semibold text-cz-1">{v}</dd></div>
      ))}
    </dl>
  );
}

function LogRow({ season, head, chips, note }: { season: string; head: string; chips?: string[]; note: string }) {
  return (
    <div className="border-t border-cz-border py-2.5">
      <div className="flex items-center gap-3"><span className="w-24 font-semibold text-cz-1">{season}</span><span className="font-data font-semibold tabular-nums text-cz-1">{head}</span></div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-cz-3">{chips?.map((c) => <Chip key={c} t={c} />)}{note}</div>
    </div>
  );
}

function Fix2() {
  return (
    <Pair intro={'Udviklingsloggen viser ændringen i rytterens samlede rating, afrundet. Ét point i én evne flytter sjældent ratingen, så der står "0 rating" lige ved siden af "Tempo +1". Efter: evnepoint er hovedtallet, og ratingen står som en lille note.'}
      before={<Card title="Udviklingslog"><LogRow season="Sæson 4" head="0 rating" chips={["Tempo +1"]} note="ingen træning registreret" /><LogRow season="Sæson 3" head="0 rating" note="ingen træning registreret" /></Card>}
      after={<Card title="Udviklingslog"><LogRow season="Sæson 4" head="+1 evnepoint" chips={["Tempo +1"]} note="rating uændret (68)" /><LogRow season="Sæson 3" head="Ingen evnepoint" note="rating uændret (68)" /></Card>} />
  );
}

function ProgRow({ role, v, band }: { role: string; v: number; band: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr_90px] items-center gap-3 border-t border-cz-border py-2 text-sm">
      <span className="text-cz-1">{role}</span>
      <span className="relative block h-1.5 overflow-hidden rounded-cz bg-cz-border"><span className="absolute inset-y-0 start-0 bg-cz-accent" style={{ width: `${v}%` }} /></span>
      <span className="text-end font-data tabular-nums text-cz-1">{band}</span>
    </div>
  );
}

function Fix3() {
  return (
    <Pair intro={'Prognosen viser et interval, også når toppen og bunden er ens ("66–66"). Det ligner et præcist, sikkert tal, men det er et skøn. Efter: ét tal, når de er ens. Ellers vises intervallet som i dag. Det gælder også akademiet og spejderen.'}
      before={<Card title="Prognose pr. ryttertype"><ProgRow role="Bakkerytter" v={66} band="66–66" /><ProgRow role="Bjergrytter" v={63} band="63 · 63–63" /><ProgRow role="Sprinter" v={34} band="34 · 34–34" /></Card>}
      after={<Card title="Prognose pr. ryttertype"><ProgRow role="Bakkerytter" v={66} band="66" /><ProgRow role="Bjergrytter" v={63} band="63" /><ProgRow role="Sprinter" v={34} band="34" /></Card>} />
  );
}

function Fix4() {
  return (
    <Pair intro={'Kortet hedder "denne sæson", men "Målt siden" er datoen for rytterens ældste måling (sæson 1). Efter: sæsonens startdato.'}
      before={<Card title="Vækst denne sæson"><KV rows={[["Evne-point vundet", "0"], ["Målt siden", "29. jun."]]} /></Card>}
      after={<Card title="Vækst denne sæson"><KV rows={[["Evne-point vundet", "0"], ["Målt siden", "28. okt. (sæsonstart)"]]} /></Card>} />
  );
}

function Fix5() {
  return (
    <Pair intro={'"Efter peak, i tilbagegang" vises for alle over 28 år. Med dagens regler holder ryttere niveauet til og med 30, og løb bremser faldet, så teksten er forkert for 29- og 30-årige. Efter: ordet følger det, motoren faktisk gør. Når XP tændes, følger det den nye aldring (top omkring 30).'}
      before={<Card title="Vækst denne sæson (29 år)"><KV rows={[["Udsigt", "Efter peak, i tilbagegang"]]} /></Card>}
      after={<Card title="Vækst denne sæson (29 år)"><KV rows={[["Udsigt", "På toppen"]]} /></Card>} />
  );
}

function RoleLine({ loft }: { loft: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-cz border border-cz-border bg-cz-card px-4 py-3">
      <div><div className="text-sm font-medium text-cz-1">Ada Pedersen</div><div className="text-2xs text-cz-3">ALDER 24 · SPRINTER</div></div>
      <div className="text-xs"><span className="font-semibold text-cz-1">SPRINTER</span> <span className="font-data tabular-nums text-cz-2">29 · 40-48{loft ? " · loft 93" : ""}</span></div>
    </div>
  );
}

function Fix6() {
  return (
    <Pair intro={'Træningssidens Udvikling-liste viser "loft 93". Lofter må ikke vises (beslutning #7932), og med XP findes der ingen lofter. Efter: loftet fjernes. Niveau og prognose står tilbage.'}
      before={<RoleLine loft />} after={<RoleLine loft={false} />} />
  );
}

function Season({ head }: { head: boolean }) {
  const rows: [string, string, string, number, string][] = [["Tempo", "5", "+1", 63, "i går +10 %"], ["Fladt", "3", "+2", 14, "i går +11 %"]];
  const COLS = "grid grid-cols-[90px_36px_50px_1fr_84px] items-center gap-2";
  return (
    <Card title="Walid Azzouz · +7 denne sæson">
      {head && <div className={`${COLS} font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3`}><span>Evne</span><span className="text-end">Nu</span><span className="text-end">Sæson</span><span>Næste point</span><span className="text-end">I går</span></div>}
      {rows.map(([n, nu, s, p, g]) => (
        <div key={n} className={`${COLS} border-t border-cz-border py-2 text-sm`}>
          <span className="text-cz-1">{n}</span>
          <span className="text-end font-data tabular-nums text-cz-1">{nu}</span>
          <span className="text-end font-data tabular-nums text-cz-success">{s}</span>
          <span className="flex items-center gap-2"><span className="relative block h-1.5 w-16 overflow-hidden rounded-cz bg-cz-border"><span className="absolute inset-y-0 start-0 bg-cz-accent" style={{ width: `${p}%` }} /></span><span className="font-data text-xs tabular-nums text-cz-2">{p} %</span></span>
          <span className="text-end text-xs text-cz-3">{g}</span>
        </div>
      ))}
    </Card>
  );
}

function Fix7() {
  return (
    <Pair intro={'Fanen Udvikling ("Denne sæson") viser små tal uden overskrift. Efter: én overskriftslinje forklarer kolonnerne: evnen nu, point i sæsonen, vejen til næste point og gårsdagens fremgang.'}
      before={<Season head={false} />} after={<Season head />} />
  );
}

function Graph({ band }: { band: boolean }) {
  return (
    <Card title="Rating pr. type · over sæsoner">
      <svg viewBox="0 0 320 155" className="w-full" role="img" aria-label="Rating over sæsoner">
        {[30, 75, 120].map((y) => <line key={y} x1="20" x2="310" y1={y} y2={y} stroke="currentColor" className="text-cz-border" strokeDasharray="2 3" />)}
        <polyline points="20,70 80,70 140,64 200,70 230,70" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-cz-accent-t" />
        <polyline points="20,92 80,92 140,88 200,92 230,92" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-cz-2" />
        {band && (
          <g>
            <rect x="232" y="22" width="76" height="40" fill="currentColor" className="text-cz-subtle" />
            <text x="304" y="17" textAnchor="end" fontSize="10" fill="currentColor" className="text-cz-accent-t">MÅL</text>
            <polyline points="230,70 260,76 290,86 308,96" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" className="text-cz-accent-t" />
          </g>
        )}
        <line x1="230" x2="230" y1="15" y2="135" stroke="currentColor" className="text-cz-border" />
        {["S1", "S2", "S3", "S4", "S5"].map((s, i) => <text key={s} x={14 + i * 52.5} y="150" fontSize="10" fill="currentColor" className="text-cz-3">{s}</text>)}
      </svg>
      <p className="mt-1 text-2xs text-cz-3">{band ? "fuld = registreret · stiplet = projektion · skraveret = mål-interval" : "fuld = registreret. Projektionen kommer tilbage, når den følger den nye udvikling."}</p>
    </Card>
  );
}

function Fix8() {
  return (
    <Pair intro={'Projektionen og MÅL-båndet bygger på en gammel model fra juni (lofter), ikke på den udvikling, der kører nu, og heller ikke på XP. Efter: kun de registrerede linjer. Projektionen kommer tilbage, når den regnes på den nye model.'}
      before={<Graph band />} after={<Graph band={false} />} />
  );
}

function FaqCard({ q, a }: { q: string; a: string }) {
  return <Card title={q}><p className="text-sm leading-relaxed text-cz-2">{a}</p></Card>;
}

function Fix9() {
  return (
    <Pair intro={'To svar i Hjælpen forklarer de gamle lofter: "færdig", "livstidsloft" og "fald efter toppen omkring 28". Det passer ikke med det, der kører nu. Efter: svarene skrives om efter de gældende regler, og når XP tændes, kommer XP-udgaven. Teksten nedenfor er et udkast og tjekkes mod reglerne før byg.'}
      before={<FaqCard q="Min rytter er færdigudviklet. Skal jeg bare sætte hvile?" a={'Når alle evner i rytterens valgte fokus har nået deres livstidsloft, står hver linje som "færdig", og mere træning giver intet ekstra … Rytterens fald efter toppen omkring 28 år kører under alle omstændigheder …'} />}
      after={<FaqCard q="Min rytter udvikler sig næsten ikke. Skal jeg sætte hvile?" a="Tæt på toppen giver hver træningsdag mindre, men træning og løb holder ham i gang og bremser aldringen. Hvile fjerner træthed, så brug den, når trætheden er høj eller før et vigtigt løb. Ellers giver let eller normal træning stadig lidt." />} />
  );
}

function Fix10() {
  return (
    <Pair intro={'Dashboardets kort "Loft før/nu" er fra overgangen i oktober og viser lofter, som ikke længere bruges. Efter: kortet fjernes.'}
      before={<Card title="Udvikling 2.0"><KV rows={[["Loft før", "93"], ["Loft nu", "—"]]} /></Card>}
      after={<div className="rounded-cz border border-dashed border-cz-border p-4 text-sm text-cz-3">Kortet er væk. Pladsen bruges af de øvrige dashboard-kort.</div>} />
  );
}

export const TITLES2: Record<string, string> = {
  "2": '2 · "0 rating" i udviklingsloggen', "3": '3 · Prognose uden bredde ("66–66")', "4": '4 · "Målt siden" på denne sæsons kort',
  "5": '5 · "Efter peak" for 29-30-årige', "6": '6 · "loft" på træningssidens Udvikling-liste', "7": "7 · Overskrift på fanen Udvikling (Denne sæson)",
  "8": "8 · MÅL-båndet i profilens graf", "9": "9 · To forkerte svar i Hjælpen", "10": '10 · Dashboardets "Loft før/nu"-kort',
};
export const FIXES2: Record<string, () => JSX.Element> = { "2": Fix2, "3": Fix3, "4": Fix4, "5": Fix5, "6": Fix6, "7": Fix7, "8": Fix8, "9": Fix9, "10": Fix10 };
