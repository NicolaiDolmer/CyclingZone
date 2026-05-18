import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import FounderSupporterWaitlistForm from "../components/waitlist/FounderSupporterWaitlistForm.jsx";

// Landing page for Founder Supporter waitlist (#361). Public route — ingen auth.
// Embedder waitlist-form (#362) som sektion. Sprog-toggle DK/EN persisteres i ?lang=.
// Pris-variant via ?variant=A|B|C styrer Option B price-test (utm_campaign er canonical
// attribution; ?variant er menneskelig debug-hint).

const VARIANT_LABELS = {
  A: "Supporter 29 / Pro 49 DKK",
  B: "Supporter 49 / Pro 89 DKK",
  C: "Supporter 69 / Pro 119 DKK",
};

const VARIANT_PRICES = {
  A: { supporter: "29", pro: "49" },
  B: { supporter: "49", pro: "89" },
  C: { supporter: "69", pro: "119" },
};

const COPY = {
  da: {
    htmlLang: "da",
    metaTitle: "Bliv Founder Supporter — Cycling Zone",
    backToApp: "← Tilbage til Cycling Zone",
    languageLabel: "Sprog",
    badgeBeta: "Open beta",
    badgeFair: "Fair freemium",
    badgeGdpr: "GDPR-compliant",
    heroEyebrow: "30-dages validation-sprint",
    heroHeadline: "Byg dit cykelhold. Vind verdens løb. Støt en fair manager MMO.",
    heroSub:
      "Cycling Zone er en browser-baseret cykel-manager MMO hvor taktik, langsigtet planlægning og community-rivalitet betyder noget. Vi tester en fair premium-model, men reglen er enkel: ",
    heroSubStrong:
      "premium køber ALDRIG stærkere ryttere, bedre løbsresultater eller konkurrencemæssige fordele.",
    ctaPrimary: "Tilmeld dig waitlisten",
    ctaSecondary: "Læs hele løftet",
    promiseTitle: "Cycling Zone forbliver fair",
    promiseBody:
      "Premium kan låse identitet, bekvemmelighed, analyser og måder at støtte udviklingen. Den kan IKKE låse bedre løbsresultater, hurtigere træning, stærkere ryttere, transfer-fordele, bedre scout-odds eller skjult magt.",
    promiseFootnote:
      "Dette løfte vises både her og ved enhver fremtidig pris-info. Det er den vigtigste tillids-besked i hele monetariserings-testen.",
    tiersTitle: "Hvad bliver fair premium?",
    tiersSub:
      "Beslutninger truffet 2026-05-14. Survey tester forskellige pris-punkter — derfor varierer Supporter mellem 29/49/69 DKK afhængig af hvor du klikker fra.",
    founderNoteTitle: "Hvor passer Founder Supporter ind?",
    founderNoteBody:
      "Founder Supporter er IKKE en separat tier — det er en waitlist-status. De første 100 Founder Supporters får permanent founder-badge når betaling åbner. Tilmelding er uforpligtende.",
    tierFree: {
      name: "Free Manager",
      price: "0 DKK",
      tagline: "Nye / casual spillere",
      bullets: [
        "Fuld konkurrencemæssig adgang",
        "Intet skåret væk fra core-spillet",
        "Free players forbliver konkurrencedygtige — for altid",
      ],
    },
    tierSupporter: {
      name: "Supporter",
      priceSuffix: "DKK/md",
      altYearTemplate: "{annual} DKK/år (= 10 måneder)",
      tagline: "Engagerede spillere",
      bullets: [
        "Supporter-badge på profil",
        "Profiltemaer + kosmetik",
        "Discord-rolle",
        "Gemte filtre + udvidet historik",
      ],
    },
    tierPro: {
      name: "Pro Analyst",
      priceSuffix: "DKK/md",
      tagline: "Hardcore managers",
      bullets: [
        "Avanceret analytics",
        "Rytter-sammenligning",
        "Scouting-dashboards",
        "Transfer-watchlists + dataeksport",
      ],
    },
    tierPatron: {
      name: "Patron",
      price: "149 DKK/md",
      tagline: "Superfans / tidlige troende",
      bullets: [
        "Founder-badge + kosmetik",
        "Dev Q&A",
        "Roadmap-stemmer (non-balance)",
        "Kreditering i spillet",
      ],
    },
    fairnessTitle: "Hvad må sælges — og hvad må aldrig sælges",
    fairnessSub: "Brand-løftet i konkrete regler. Klippe-fast.",
    soldCol: "Må sælges",
    notSoldCol: "Må IKKE sælges (pay-to-win)",
    sold: [
      "Supporter-badge",
      "Profiltemaer / kosmetik",
      "Discord-rolle",
      "Gemte dashboards",
      "Udvidet historik",
      "Analytics & rytter-sammenligning",
      "Dataeksport",
      "Roadmap-stemmer (non-balance)",
    ],
    notSold: [
      "Hurtigere træning",
      "Bedre løbsudfald",
      "Større transferbudget",
      "Bedre scout-odds",
      "Eksklusive ranked-løb for betalere",
      "Paid currency der ændrer balance",
      "Power-features",
      "Stemmer der ændrer balance / økonomi",
    ],
    benefitsTitle: "Hvad får Founder Supporters?",
    benefitsBody:
      "Founder-status er identitet og tak — aldrig konkurrencefordele. Endelig liste fastlægges sammen med community før betaling åbner.",
    benefitsList: [
      { title: "Permanent founder-badge", desc: "Identitets-mærke der ikke kan købes senere." },
      { title: "Discord Founder-rolle", desc: "Stærkt community-signal." },
      { title: "Profil-tema eller kosmetisk frame", desc: "Tidlig-supporter værdi." },
      { title: "Navn på Founder Wall", desc: "Til tidlige troende." },
      { title: "Månedlige dev-opdateringer", desc: "Bygger tillid + transparens." },
      { title: "Stemme på non-balance roadmap-emner", desc: "Aldrig om balance eller konkurrencefordele." },
    ],
    formSectionTitle: "Tilmeld dig waitlisten",
    formSectionSub:
      "Det er IKKE bindende. Vi opkræver intet under validation-sprinten. Formålet er at se om der er nok cyklister der vil støtte projektet økonomisk inden vi bygger betaling.",
    faqTitle: "Spørgsmål vi har hørt",
    faqItems: [
      {
        q: "Bliver Cycling Zone pay-to-win?",
        a: "Nej. Den konkurrencemæssige kerne SKAL forblive fair. Premium handler om identitet, bekvemmelighed, analyser og at støtte udvikling.",
      },
      {
        q: "Kan free players konkurrere?",
        a: "Ja. Free players har fuld adgang til det konkurrencemæssige core-spil. Det er fundamentet for fairness.",
      },
      {
        q: "Kan premium-brugere købe stærkere ryttere eller hurtigere træning?",
        a: "Nej. De features må ikke sælges — punktum.",
      },
      {
        q: "Hvorfor teste premium nu?",
        a: "For at lære om Cycling Zone kan blive bæredygtigt FØR vi bygger det forkerte monetariserings-system. Bedre at validere før investering.",
      },
      {
        q: "Er betaling live nu?",
        a: "Nej. Waitlist først, betaling senere — og kun hvis community-svaret er positivt. Du opkræves intet ved tilmelding.",
      },
      {
        q: "Hvad sker der hvis folk ikke vil have premium?",
        a: "Så venter monetariseringen, og fokus går tilbage til retention, gameplay og community-vækst. Det er hele pointen med at teste først.",
      },
    ],
    footerPrivacy: "Privatlivspolitik",
    footerBack: "← Tilbage til Cycling Zone",
    footerSprintRef: "Refs sprint-validation #361/#362/#363. Foundation #359.",
  },
  en: {
    htmlLang: "en",
    metaTitle: "Become a Founder Supporter — Cycling Zone",
    backToApp: "← Back to Cycling Zone",
    languageLabel: "Language",
    badgeBeta: "Open beta",
    badgeFair: "Fair freemium",
    badgeGdpr: "GDPR-compliant",
    heroEyebrow: "30-day validation sprint",
    heroHeadline: "Build your cycling team. Race the world. Support a fair manager MMO.",
    heroSub:
      "Cycling Zone is a browser-based cycling manager MMO where tactics, long-term planning and community rivalry matter. We're exploring a fair premium model, but the rule is simple: ",
    heroSubStrong:
      "premium will NEVER buy stronger riders, better race results or competitive advantages.",
    ctaPrimary: "Join the waitlist",
    ctaSecondary: "Read the full promise",
    promiseTitle: "Cycling Zone will stay fair",
    promiseBody:
      "Premium can unlock identity, convenience, analytics and ways to support development. It will NOT unlock better race results, faster training, stronger riders, transfer advantages, better scouting odds or hidden power.",
    promiseFootnote:
      "This promise appears here and near any future pricing info. It's the most important trust message in the entire monetization test.",
    tiersTitle: "What might fair premium look like?",
    tiersSub:
      "Decisions made 2026-05-14. The survey tests different price points — Supporter varies between 29/49/69 DKK depending on which link you clicked.",
    founderNoteTitle: "Where does Founder Supporter fit?",
    founderNoteBody:
      "Founder Supporter is NOT a separate tier — it's a waitlist status. The first 100 Founder Supporters get a permanent founder badge when payment opens. Signing up is non-binding.",
    tierFree: {
      name: "Free Manager",
      price: "0 DKK",
      tagline: "New / casual players",
      bullets: [
        "Full competitive access",
        "Nothing cut from the core game",
        "Free players stay competitive — forever",
      ],
    },
    tierSupporter: {
      name: "Supporter",
      priceSuffix: "DKK/mo",
      altYearTemplate: "{annual} DKK/yr (= 10 months)",
      tagline: "Engaged players",
      bullets: [
        "Supporter badge on profile",
        "Profile themes + cosmetics",
        "Discord role",
        "Saved filters + extended history",
      ],
    },
    tierPro: {
      name: "Pro Analyst",
      priceSuffix: "DKK/mo",
      tagline: "Hardcore managers",
      bullets: [
        "Advanced analytics",
        "Rider comparison",
        "Scouting dashboards",
        "Transfer watchlists + data export",
      ],
    },
    tierPatron: {
      name: "Patron",
      price: "149 DKK/mo",
      tagline: "Superfans / early believers",
      bullets: [
        "Founder badge + cosmetics",
        "Dev Q&A",
        "Roadmap votes (non-balance)",
        "Credit in the game",
      ],
    },
    fairnessTitle: "What may be sold — and what must never be sold",
    fairnessSub: "The brand promise as concrete rules. Rock-solid.",
    soldCol: "May be sold",
    notSoldCol: "May NOT be sold (pay-to-win)",
    sold: [
      "Supporter badge",
      "Profile themes / cosmetics",
      "Discord role",
      "Saved dashboards",
      "Extended history",
      "Analytics & rider comparison",
      "Data export",
      "Roadmap votes (non-balance)",
    ],
    notSold: [
      "Faster training",
      "Better race outcomes",
      "Larger transfer budget",
      "Better scouting odds",
      "Exclusive ranked races for paying users",
      "Paid currency that alters balance",
      "Power features",
      "Votes that change balance / economy",
    ],
    benefitsTitle: "What do Founder Supporters get?",
    benefitsBody:
      "Founder status is identity and a thank-you — never competitive advantage. The final list is decided together with the community before payment opens.",
    benefitsList: [
      { title: "Permanent founder badge", desc: "Identity mark that can't be bought later." },
      { title: "Discord Founder role", desc: "Strong community signal." },
      { title: "Profile theme or cosmetic frame", desc: "Early-supporter value." },
      { title: "Name on the Founder Wall", desc: "For early believers." },
      { title: "Monthly dev updates", desc: "Builds trust + transparency." },
      { title: "Vote on non-balance roadmap topics", desc: "Never about balance or competitive advantage." },
    ],
    formSectionTitle: "Join the waitlist",
    formSectionSub:
      "It's NOT binding. We charge nothing during the validation sprint. The goal is to see whether enough cyclists want to support the project financially before we build payment.",
    faqTitle: "Questions we've heard",
    faqItems: [
      {
        q: "Is Cycling Zone becoming pay-to-win?",
        a: "No. The competitive core MUST stay fair. Premium is about identity, convenience, analytics and supporting development.",
      },
      {
        q: "Can free players compete?",
        a: "Yes. Free players have full access to the competitive core game. That's the foundation of fairness.",
      },
      {
        q: "Can premium users buy stronger riders or faster training?",
        a: "No. Those features must not be sold — period.",
      },
      {
        q: "Why test premium now?",
        a: "To learn whether Cycling Zone can become sustainable BEFORE we build the wrong monetization system. Better to validate before investing.",
      },
      {
        q: "Is payment live now?",
        a: "No. Waitlist first, payment later — and only if the community response is positive. You're charged nothing when joining.",
      },
      {
        q: "What happens if people don't want premium?",
        a: "Then monetization waits, and focus returns to retention, gameplay and community growth. That's the whole point of testing first.",
      },
    ],
    footerPrivacy: "Privacy policy",
    footerBack: "← Back to Cycling Zone",
    footerSprintRef: "Refs sprint-validation #361/#362/#363. Foundation #359.",
  },
};

function LanguageToggle({ lang, onChange, label }) {
  return (
    <div className="inline-flex items-center gap-1 bg-cz-subtle border border-cz-border rounded-lg p-0.5" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange("da")}
        aria-pressed={lang === "da"}
        className={
          "px-3 py-1 text-xs font-semibold rounded-md transition-all " +
          (lang === "da" ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
        }
      >
        DA
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        aria-pressed={lang === "en"}
        className={
          "px-3 py-1 text-xs font-semibold rounded-md transition-all " +
          (lang === "en" ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:text-cz-1")
        }
      >
        EN
      </button>
    </div>
  );
}

function TierCard({ tier, highlighted = false }) {
  return (
    <div
      className={
        "flex flex-col gap-3 rounded-2xl border p-5 transition-all " +
        (highlighted
          ? "border-cz-accent bg-cz-accent/5 shadow-[0_4px_30px_rgba(232,197,71,0.15)]"
          : "border-cz-border bg-cz-card")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-cz-1 text-lg font-bold">{tier.name}</h3>
        <div className="text-right">
          <div className="text-cz-1 text-xl font-bold">
            {tier.price}
            {tier.priceSuffix && (
              <span className="text-cz-3 text-xs font-normal ml-1">{tier.priceSuffix}</span>
            )}
          </div>
          {tier.altYear && <div className="text-cz-3 text-[11px]">{tier.altYear}</div>}
        </div>
      </div>
      <p className="text-cz-3 text-xs uppercase tracking-wider">{tier.tagline}</p>
      <ul className="flex flex-col gap-1.5 text-cz-2 text-sm">
        {tier.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 w-1 h-1 rounded-full bg-cz-accent flex-shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FaqItem({ q, a, idx }) {
  const [open, setOpen] = useState(idx === 0);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.target.open)}
      className="group border-b border-cz-border last:border-b-0"
    >
      <summary className="flex items-center justify-between gap-3 py-4 cursor-pointer list-none">
        <span className="text-cz-1 text-sm sm:text-base font-medium">{q}</span>
        <span
          className={
            "text-cz-accent text-lg transition-transform duration-200 " +
            (open ? "rotate-45" : "")
          }
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      <p className="text-cz-2 text-sm pb-4 pr-8 leading-relaxed">{a}</p>
    </details>
  );
}

export default function FounderSupporterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variantKey = (searchParams.get("variant") || "").toUpperCase();
  const variantLabel = VARIANT_LABELS[variantKey] || null;
  const variantPrices = VARIANT_PRICES[variantKey] || { supporter: "49", pro: "89" };

  const langParam = (searchParams.get("lang") || "").toLowerCase();
  const initialLang = langParam === "en" ? "en" : "da";
  const [lang, setLang] = useState(initialLang);
  const t = COPY[lang];

  // Sync ?lang= → URL så delte links bevarer sproget.
  function handleLangChange(next) {
    setLang(next);
    const params = new URLSearchParams(searchParams);
    if (next === "da") params.delete("lang");
    else params.set("lang", next);
    setSearchParams(params, { replace: true });
  }

  // Opdater <html lang=...> + <title> + canonical dynamisk for accessibility + SEO.
  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    document.title = t.metaTitle;
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = "https://cycling-zone.vercel.app/founder-supporter";
  }, [t.htmlLang, t.metaTitle]);

  // Bevar useMemo så vi ikke regenererer ved hver render.
  const tierFreeData = useMemo(() => t.tierFree, [t]);
  const tierSupporterData = useMemo(() => {
    const monthly = Number(variantPrices.supporter);
    const annual = Number.isFinite(monthly) ? monthly * 10 : null;
    return {
      ...t.tierSupporter,
      price: variantPrices.supporter,
      altYear: annual != null && t.tierSupporter.altYearTemplate
        ? t.tierSupporter.altYearTemplate.replace("{annual}", String(annual))
        : null,
    };
  }, [t, variantPrices.supporter]);
  const tierProData = useMemo(() => ({ ...t.tierPro, price: variantPrices.pro }), [t, variantPrices.pro]);
  const tierPatronData = useMemo(() => t.tierPatron, [t]);

  return (
    <div className="min-h-screen bg-cz-body">
      {/* ----- Sticky top-bar ----- */}
      <header className="sticky top-0 z-40 bg-cz-body/90 backdrop-blur-md border-b border-cz-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-cz-accent shadow-[0_0_20px_rgba(232,197,71,0.3)]">
              <span className="text-cz-on-accent font-black text-base">C</span>
            </span>
            <span className="text-cz-1 font-bold text-sm tracking-tight hidden sm:inline">Cycling Zone</span>
          </Link>
          <LanguageToggle lang={lang} onChange={handleLangChange} label={t.languageLabel} />
        </div>
      </header>

      <main>
        {/* ----- Hero ----- */}
        <section className="px-4 sm:px-6 pt-12 sm:pt-20 pb-12 sm:pb-16">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-cz-accent text-xs font-bold uppercase tracking-[0.2em] mb-4">
              {t.heroEyebrow}
            </p>
            <h1 className="text-cz-1 text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1]">
              {t.heroHeadline}
            </h1>
            <p className="text-cz-2 text-base sm:text-lg mt-6 max-w-2xl mx-auto leading-relaxed">
              {t.heroSub}
              <strong className="text-cz-1">{t.heroSubStrong}</strong>
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#waitlist"
                className="inline-flex items-center justify-center px-6 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm shadow-[0_4px_20px_rgba(232,197,71,0.3)] hover:brightness-110 transition-all"
              >
                {t.ctaPrimary}
              </a>
              <a
                href="#promise"
                className="inline-flex items-center justify-center px-6 py-3 border border-cz-border text-cz-1 font-medium rounded-lg text-sm hover:bg-cz-subtle transition-all"
              >
                {t.ctaSecondary}
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-cz-2 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t.badgeBeta}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t.badgeFair}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cz-accent" />
                {t.badgeGdpr}
              </span>
            </div>
          </div>
        </section>

        {/* ----- Fair Premium Promise ----- */}
        <section id="promise" className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border">
          <div className="max-w-3xl mx-auto">
            <div className="bg-cz-card border-2 border-cz-accent/40 rounded-2xl p-6 sm:p-8 shadow-[0_4px_40px_rgba(232,197,71,0.1)]">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3 flex items-center gap-2">
                <span className="text-cz-accent">✓</span>
                {t.promiseTitle}
              </h2>
              <p className="text-cz-1 text-base sm:text-lg leading-relaxed">{t.promiseBody}</p>
              <p className="text-cz-3 text-xs mt-4 italic">{t.promiseFootnote}</p>
            </div>
          </div>
        </section>

        {/* ----- Tier comparison ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t.tiersTitle}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t.tiersSub}</p>
              {variantLabel && (
                <p className="mt-3 inline-flex items-center gap-2 bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-1.5 text-cz-1 text-xs">
                  <span className="text-cz-3">Variant:</span>
                  <span className="font-semibold">{variantLabel}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TierCard tier={tierFreeData} />
              <TierCard tier={tierSupporterData} highlighted />
              <TierCard tier={tierProData} />
              <TierCard tier={tierPatronData} />
            </div>

            <div className="mt-8 max-w-3xl mx-auto bg-cz-subtle border border-cz-border rounded-xl p-5">
              <h3 className="text-cz-1 text-base font-semibold mb-2 flex items-center gap-2">
                <span className="text-cz-accent">★</span>
                {t.founderNoteTitle}
              </h3>
              <p className="text-cz-2 text-sm leading-relaxed">{t.founderNoteBody}</p>
            </div>
          </div>
        </section>

        {/* ----- What may / may not be sold ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-2">{t.fairnessTitle}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t.fairnessSub}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cz-card border border-cz-border rounded-xl p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <span className="text-emerald-500">✓</span>
                  {t.soldCol}
                </h3>
                <ul className="flex flex-col gap-2">
                  {t.sold.map((item, i) => (
                    <li key={i} className="text-cz-2 text-sm flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-cz-card border border-cz-danger/30 rounded-xl p-5">
                <h3 className="text-cz-1 text-base font-semibold mb-3 flex items-center gap-2">
                  <span className="text-cz-danger">✗</span>
                  {t.notSoldCol}
                </h3>
                <ul className="flex flex-col gap-2">
                  {t.notSold.map((item, i) => (
                    <li key={i} className="text-cz-2 text-sm flex items-start gap-2">
                      <span className="text-cz-danger mt-0.5">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ----- Founder Supporter benefits ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t.benefitsTitle}</h2>
              <p className="text-cz-2 text-sm sm:text-base max-w-2xl mx-auto">{t.benefitsBody}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {t.benefitsList.map((b, i) => (
                <div key={i} className="bg-cz-card border border-cz-border rounded-xl p-4">
                  <h3 className="text-cz-1 text-sm font-semibold mb-1">{b.title}</h3>
                  <p className="text-cz-3 text-xs leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----- Waitlist form ----- */}
        <section id="waitlist" className="px-4 sm:px-6 py-12 sm:py-16 bg-cz-subtle/40 border-y border-cz-border scroll-mt-16">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold mb-3">{t.formSectionTitle}</h2>
              <p className="text-cz-2 text-sm sm:text-base">{t.formSectionSub}</p>
            </div>
            <FounderSupporterWaitlistForm priceVariantLabel={variantLabel} lang={lang} />
          </div>
        </section>

        {/* ----- FAQ ----- */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-cz-1 text-2xl sm:text-3xl font-bold text-center mb-8">{t.faqTitle}</h2>
            <div className="bg-cz-card border border-cz-border rounded-2xl px-5 sm:px-6">
              {t.faqItems.map((item, i) => (
                <FaqItem key={i} idx={i} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-cz-border px-4 sm:px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-cz-3 text-xs">
          <p>{t.footerSprintRef}</p>
          <div className="flex items-center gap-4">
            <Link to={lang === "en" ? "/privacy-policy" : "/privatlivspolitik"} className="hover:text-cz-1 transition-colors">
              {t.footerPrivacy}
            </Link>
            <Link to="/" className="hover:text-cz-1 transition-colors">
              {t.footerBack}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
