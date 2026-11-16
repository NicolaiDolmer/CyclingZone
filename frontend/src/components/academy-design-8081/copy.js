// #8081: spillertekst til de tre designudgaver, EN først og DA under.
//
// Udgaverne er et designvalg bag ?design8081=a|b|c og merges ikke. Teksten bor
// derfor her i stedet for i public/locales/*/academy.json, så designet ikke
// skal oversættes til fem sprog før ejeren har valgt. Den valgte udgave flytter
// sine nøgler ind i academy.json (en, da, es, fr, nl) når den bygges.
import { useTranslation } from "react-i18next";

const EN = {
  variantA: "Design A: overview and tabs",
  variantB: "Design B: one page with a side column",
  variantC: "Design C: one list from candidate to squad",
  previewNote: "Design preview. Nothing here is saved.",

  "tabs.intake": "This week's intake",
  "tabs.talents": "Your talents",
  "tabs.ledger": "Academy accounts",
  "tabs.profile": "Profile and age",

  "squad.junior": "Junior",
  "squad.u23": "U23",
  "squad.senior": "Senior",
  "squads.title": "Squads",
  "squads.total": "Whole team",
  "squads.temporary": "Temporary limits",
  "squads.count": "{used} / {max}",
  "squads.full": "Full",

  "stats.netSeason": "Net this season",
  "stats.talents": "Talents",
  "stats.intakeOpen": "Ready to pull",
  "stats.intakeDone": "Pulled this week",
  "stats.intake": "Intake",

  "landing.on": "Lands on {squad}",
  "landing.none": "No room on any squad",

  "talents.title": "Your talents",
  "talents.colRider": "Rider",
  "talents.colType": "Rider type",
  "talents.colSquad": "Squad",
  "talents.colAge": "Age",
  "talents.colPrognosis": "Prognosis",
  "talents.colVia": "Came via",
  "talents.emptyTitle": "Pull this week's candidates",
  "talents.emptyBody": "Talents you sign show up here with their rider type.",
  "talents.emptyAction": "Go to the intake",

  "origin.offer": "Academy offer",
  "origin.youthAuction": "Youth auction",

  "ledger.title": "Academy accounts",
  "ledger.caption": "Purchases and sales count the same riders: everyone you signed from an offer or won at a youth auction.",
  "ledger.colSeason": "Season",
  "ledger.season": "Season {n}",
  "ledger.thisSeason": "This season",
  "ledger.offerSignings": "Signed from offers",
  "ledger.youthAuctionBuys": "Bought at youth auction",
  "ledger.drift": "Running costs",
  "ledger.driftHistoric": "Running costs (old seasons)",
  "ledger.sales": "Sales",
  "ledger.salesCount": "{count} sold",
  "ledger.net": "Net",
  "ledger.total": "All seasons",
  "ledger.earlier": "Earlier seasons",
  "ledger.salesTitle": "Sales of academy riders",
  "ledger.colDate": "Sold",
  "ledger.colPrice": "Price",
  "ledger.colVia": "Came via",
  "ledger.emptySalesTitle": "Sell a talent to see the return",
  "ledger.emptySalesBody": "Every academy rider you sell is counted here, by season.",
  "ledger.emptySalesAction": "Open the U23 squad",
  "ledger.errorTitle": "The accounts didn't load",
  "ledger.errorBody": "Nothing was changed. Try again in a moment.",
  "ledger.retry": "Try again",
  "ledger.allSales": "Show all {count} sales",

  "age.label": "Age focus",
  "age.mixed": "Mixed",
  "age.intro": "Pick the age your weekly candidates lean towards. Every age still shows up.",
  "age.share.many": "many",
  "age.share.some": "some",
  "age.share.few": "few",
  "age.row": "{age}: {share}",
  "age.toU23": "19-year-olds always join U23.",
  "age.summary": "Age focus: {focus}",

  "c.groupCandidates": "Candidates this week",
  "c.groupJunior": "Junior squad",
  "c.groupU23": "U23 squad",
  "c.colAction": "Action",
  "c.fee": "Fee",
  "c.profileLine": "Profile",
  "c.edit": "Change",
};

const DA = {
  variantA: "Udgave A: overblik og faner",
  variantB: "Udgave B: én side med sidekolonne",
  variantC: "Udgave C: én liste fra kandidat til trup",
  previewNote: "Designudkast. Intet her gemmes.",

  "tabs.intake": "Ugens optag",
  "tabs.talents": "Dine talenter",
  "tabs.ledger": "Akademi-regnskab",
  "tabs.profile": "Profil og alder",

  "squad.junior": "Junior",
  "squad.u23": "U23",
  "squad.senior": "Senior",
  "squads.title": "Trupper",
  "squads.total": "Hele holdet",
  "squads.temporary": "Midlertidige grænser",
  "squads.count": "{used} / {max}",
  "squads.full": "Fuld",

  "stats.netSeason": "Netto denne sæson",
  "stats.talents": "Talenter",
  "stats.intakeOpen": "Klar til at hente",
  "stats.intakeDone": "Hentet i denne uge",
  "stats.intake": "Optag",

  "landing.on": "Lander på {squad}",
  "landing.none": "Ingen plads på nogen trup",

  "talents.title": "Dine talenter",
  "talents.colRider": "Rytter",
  "talents.colType": "Ryttertype",
  "talents.colSquad": "Trup",
  "talents.colAge": "Alder",
  "talents.colPrognosis": "Prognose",
  "talents.colVia": "Kom via",
  "talents.emptyTitle": "Hent ugens kandidater",
  "talents.emptyBody": "Talenter, du henter, står her med deres ryttertype.",
  "talents.emptyAction": "Gå til optaget",

  "origin.offer": "Akademi-tilbud",
  "origin.youthAuction": "Ungdomsauktion",

  "ledger.title": "Akademi-regnskab",
  "ledger.caption": "Køb og salg tæller de samme ryttere: alle du har hentet fra et tilbud eller vundet på ungdomsauktion.",
  "ledger.colSeason": "Sæson",
  "ledger.season": "Sæson {n}",
  "ledger.thisSeason": "Denne sæson",
  "ledger.offerSignings": "Hentet fra tilbud",
  "ledger.youthAuctionBuys": "Købt på ungdomsauktion",
  "ledger.drift": "Drift",
  "ledger.driftHistoric": "Drift (tidligere sæsoner)",
  "ledger.sales": "Salg",
  "ledger.salesCount": "{count} solgt",
  "ledger.net": "Netto",
  "ledger.total": "Alle sæsoner",
  "ledger.earlier": "Tidligere sæsoner",
  "ledger.salesTitle": "Salg af akademiryttere",
  "ledger.colDate": "Solgt",
  "ledger.colPrice": "Pris",
  "ledger.colVia": "Kom via",
  "ledger.emptySalesTitle": "Sælg et talent for at se afkastet",
  "ledger.emptySalesBody": "Hver akademirytter, du sælger, tælles her pr. sæson.",
  "ledger.emptySalesAction": "Åbn U23-truppen",
  "ledger.errorTitle": "Regnskabet kunne ikke hentes",
  "ledger.errorBody": "Intet blev ændret. Prøv igen om lidt.",
  "ledger.retry": "Prøv igen",
  "ledger.allSales": "Vis alle {count} salg",

  "age.label": "Aldersfokus",
  "age.mixed": "Blandet",
  "age.intro": "Vælg den alder, dine ugentlige kandidater hælder mod. Alle aldre dukker stadig op.",
  "age.share.many": "mange",
  "age.share.some": "nogle",
  "age.share.few": "få",
  "age.row": "{age}: {share}",
  "age.toU23": "19-årige går altid på U23.",
  "age.summary": "Aldersfokus: {focus}",

  "c.groupCandidates": "Ugens kandidater",
  "c.groupJunior": "Juniortruppen",
  "c.groupU23": "U23-truppen",
  "c.colAction": "Handling",
  "c.fee": "Pris",
  "c.profileLine": "Profil",
  "c.edit": "Ret",
};

export const DESIGN_8081_COPY = Object.freeze({ en: EN, da: DA });

/** Slå en nøgle op og flet {navn}-pladsholdere ind. Ukendt sprog = engelsk. */
export function designCopy(lang, key, vars = {}) {
  const dict = String(lang ?? "").toLowerCase().startsWith("da") ? DA : EN;
  const raw = dict[key] ?? EN[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
}

/** Hook: c("ledger.title") i komponenterne, på sidens aktuelle sprog. */
export function useDesignCopy() {
  const { i18n } = useTranslation();
  const lang = i18n?.resolvedLanguage || i18n?.language || "en";
  return (key, vars) => designCopy(lang, key, vars);
}
