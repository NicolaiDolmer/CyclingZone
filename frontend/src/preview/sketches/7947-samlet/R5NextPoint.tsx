// #7947: tre maader at vise "naeste point" paa (ejer 19/11: vis forslagene visuelt).
// A: "x af y XP" (prisen synlig), B: bjaelke + "ca. N dage", C: begge. Navne og tal er eksempler.
type Ab = { name: string; level: number; xp: number; price: number; days: number };
const ABS: Ab[] = [
  { name: "Climbing", level: 70, xp: 312, price: 540, days: 4 },
  { name: "Tempo", level: 61, xp: 96, price: 410, days: 9 },
  { name: "Punch", level: 74, xp: 588, price: 610, days: 1 },
];

function Bar({ pct }: { pct: number }) {
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-cz bg-cz-border">
      <span className="absolute inset-y-0 start-0 bg-cz-1" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Variant({ id, title, sub, render }: { id: string; title: string; sub: string; render: (a: Ab) => React.ReactNode }) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4" id={id}>
      <h3 className="font-data text-base font-semibold text-cz-1">{title}</h3>
      <p className="mt-0.5 text-xs text-cz-2">{sub}</p>
      <div className="mb-1 mt-3 grid grid-cols-[90px_44px_1fr] gap-x-3 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
        <span>Ability</span><span className="text-end">Now</span><span>Next point</span>
      </div>
      <ul className="text-xs">
        {ABS.map((a) => (
          <li key={a.name} className="grid grid-cols-[90px_44px_1fr] items-center gap-x-3 border-t border-cz-border py-2">
            <span className="text-cz-1">{a.name}</span>
            <span className="text-end font-data text-[13px] tabular-nums text-cz-1">{a.level}</span>
            <span>{render(a)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function NextPoint() {
  const pct = (a: Ab) => Math.round((a.xp / a.price) * 100);
  return (
    <div id="shot" className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Development · next point</div>
      <h2 className="font-data text-xl font-bold leading-tight text-cz-1">Three ways to show the way to the next point</h2>
      <p className="mt-1 max-w-[72ch] text-sm text-cz-2">Same rider, same day. The bar is the same in all three; only the words next to it change.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Variant id="a" title="A · x of y XP" sub="Exact. Shows the price, so the price list can be worked out."
          render={(a) => (<span className="flex items-center gap-2"><Bar pct={pct(a)} /><span className="whitespace-nowrap font-data text-[13px] tabular-nums text-cz-1">{a.xp} / {a.price} XP</span></span>)} />
        <Variant id="b" title="B · About N days" sub="Easy to read, keeps the price private. Today's XP still shows elsewhere."
          render={(a) => (<span className="flex items-center gap-2"><Bar pct={pct(a)} /><span className="whitespace-nowrap text-cz-1">{a.days === 1 ? "about 1 day" : `about ${a.days} days`}</span></span>)} />
        <Variant id="c" title="C · Both" sub="Everything at once. Most to read, and the price is public."
          render={(a) => (<span className="flex items-center gap-2"><Bar pct={pct(a)} /><span className="whitespace-nowrap font-data text-[13px] tabular-nums text-cz-1">{a.xp}/{a.price}</span><span className="whitespace-nowrap text-cz-3">· ~{a.days} d</span></span>)} />
      </div>
      <p className="mt-3 text-2xs text-cz-3">"About N days" is an estimate from his own XP over the last 30 days. Names and numbers are examples.</p>
    </div>
  );
}
