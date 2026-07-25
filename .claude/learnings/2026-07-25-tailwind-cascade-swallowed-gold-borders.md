# Tailwind-cascaden slugte guld-borderfarver i tre år-gamle flader — og kun guld

**Dato:** 2026-07-25 · **Issue:** #2849 bølge 6 · **Klasse:** tavs UI-degradering via CSS-rækkefølge

## Hvad der skete

`Card`/`Section` bagte `border border-cz-border` ind i deres basisklasse. Flere sider ville
markere en tilstand med en anden kant og sendte farven med i `className`:

```jsx
<Card className={imWinning ? "border-cz-accent/40" : ""}>          // auktioner
<Section className={isPending ? "border-cz-accent/30" : "..."}>    // transfers
<Card className={is_expired ? "border-cz-accent/40" : ""}>         // board
```

Ingen af dem virkede. Tailwind emitterer utilities i temaets egen rækkefølge, og målt i
`dist/assets/index-*.css` ligger `.border-cz-border` på byte 22745 — **efter**
`.border-cz-accent-t` (22103), `.border-cz-accent/30` (22509) og `.border-cz-accent/40` (22568).
Sidste regel vinder ved samme specificitet, så Cards egen hairline slog kalderens farve.

## Hvorfor det overlevede så længe

Fordi det **kun** ramte guld. De samme sider bruger `border-cz-danger/30` (23114) og
`border-cz-info/30` (23519) i nabo-grene — og de ligger EFTER `.border-cz-border`, så de virkede
perfekt. På transferkortet betød det at "afventer modpart" fik sin blå kant, mens "afventer dig"
ikke fik sin gyldne. Det ligner et bevidst designvalg, ikke en fejl.

Der var heller ingen test der kunne fange det: unit-tests ser JSX-strengen (som er korrekt),
og snapshot-tests var taget EFTER fejlen opstod, så den forkerte tilstand var baseline.

Auktionskortet havde oveni `bg-cz-accent/10/40` — en malformet klasse med dobbelt alpha der
aldrig emitterede CSS. "Du fører denne auktion" var altså dobbelt død.

## Hvordan det blev fundet

Ikke ved at lede efter det. En sonnet-worker på sæsonplanlæggeren skulle give et banner en
guldkant, opdagede at det ikke virkede, og løste det lokalt med en inline `style`. Rapporten
nævnte det som en sidebemærkning med en påstand om rækkefølgen — og en påstand om
CSS-rækkefølge er præcis den slags der skal måles, ikke tros. Grep i det byggede bundt bekræftede
den, og udvidede den fra ét banner til fire callsites på tre live spillerflader.

## Fix

`Card` tager nu farven som prop, ikke som klasse:

```jsx
export default function Card({ borderClass = "border-cz-border", className = "", ... }) {
  const base = `rounded-cz border ${borderClass} bg-cz-card`;
```

`Section` videresender via `...rest`, så begge dækkes.

## Forward-guard

`card.source.test.js` scanner hele `src` for `<Card|Section ... className="... border-cz-{accent,
success,danger,warning,info}">` og fejler. `group-hover:`-varianter er undtaget — de emitteres i et
langt senere lag (62226) og vinder.

## Læringen, generelt

**En klasse der "vinder nogle gange" er farligere end en der aldrig virker.** Hvis alle fire
statusfarver havde tabt cascaden, var det opdaget med det samme. At tre ud af fire virkede gjorde
den fjerde til et plausibelt designvalg.

To konkrete konsekvenser:

1. **Bag aldrig en overskrivbar egenskab ind i en delt primitivs basisklasse.** Hvis en kalder
   realistisk vil ændre den, skal den være en prop. `className` er til tilføjelser, ikke til
   overstyringer — Tailwind giver ingen garanti for at kalderens klasse vinder.
2. **Verificér CSS-rækkefølge-påstande i det byggede bundt.** `grep -bo '.klasse{' dist/assets/*.css`
   giver byte-positionen. Det tager tredive sekunder og er forskellen på en hypotese og et fund.

Beslægtet: `bg-cz-accent-bg` blev fundet i samme gennemgang — en klasse der slet ikke findes i
`tailwind.config.js`, brugt 5 steder i admin. Samme familie af fejl: klassen ser rigtig ud i koden,
og der er intet i værktøjskæden der siger fra.
