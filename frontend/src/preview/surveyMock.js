// #4943 · Preview-/e2e-seed for det in-app spørgeskema.
//
// Egen fil frem for en blok i seedData.js: skemaet er kampagne-data med en
// levetid, og det er dét eneste seed der bevidst IKKE serveres som default.
// mockHandlers' "surveys"-case returnerer en tom liste, fordi et åbent skema
// ellers ville vise dashboard-kortet i ALLE siders visuelle snapshots (samme
// grund som SEED_OPS_NOTICES). Specs og shots-scripts overlejrer selv rækkerne
// med installSurveyRoutes() nedenfor.
//
// Spørgsmålene er de samme 11 som seedes af
// database/2026-09-07-4943-in-app-survey.sql (ejer-beslutninger 8/9, #4943),
// så preview viser den rigtige side.

export const SEED_SURVEY = {
  id: "survey-e2e",
  slug: "2026-09-features",
  title_en: "What should I build next?",
  title_da: "Hvad skal jeg bygge næste gang?",
  status: "open",
  opens_at: "2026-09-08T06:00:00Z",
  closes_at: null,
};

const FEATURES = [
  { key: "live_race", label_en: "Follow a race live while it happens, stage by stage", label_da: "Følg et løb live mens det kører, etape for etape" },
  { key: "races_train_you", label_en: "Races train you: riding cobbled races makes you better on cobbles", label_da: "Løbene træner dig: kører du brostensløb, bliver du bedre til brosten" },
  { key: "jersey_targets", label_en: "Target the mountains or points jersey from the start", label_da: "Gå efter bjerg- eller pointtrøjen fra løbets start" },
  { key: "training_programs", label_en: "Build a training week once as a reusable program", label_da: "Byg en træningsuge én gang som et genbrugeligt program" },
  { key: "shared_programs", label_en: "Share training programs and use other managers programs", label_da: "Del træningsprogrammer og brug andre manageres programmer" },
  { key: "form_training", label_en: "Form training for riders who no longer gain skills", label_da: "Formtræning til ryttere der ikke længere kan lære mere" },
  { key: "youth_teams", label_en: "U23 and junior teams with their own races", label_da: "U23- og juniorhold med deres egne løb" },
  { key: "team_looks", label_en: "Team looks: kit colours, logo and rider portraits", label_da: "Holdets udseende: trøjefarver, logo og rytterportrætter" },
  { key: "deeper_staff", label_en: "Deeper staff: more roles, real strengths and weaknesses", label_da: "Dybere personale: flere roller, rigtige styrker og svagheder" },
  { key: "inbox_transfers", label_en: "Handle transfer offers straight from your inbox", label_da: "Håndtér transfertilbud direkte fra din indbakke" },
  { key: "manager_messages", label_en: "Send messages to other managers inside the game", label_da: "Send beskeder til andre managere inde i spillet" },
  { key: "custom_front_page", label_en: "A front page you set up yourself, showing what needs action", label_da: "En forside du selv sætter op, med det der kræver handling" },
];

const WORST = [
  { key: "racing", label_en: "Racing and results", label_da: "Løbene og resultaterne" },
  { key: "training", label_en: "Training and rider development", label_da: "Træning og rytterudvikling" },
  { key: "market", label_en: "Transfers and auctions", label_da: "Transfers og auktioner" },
  { key: "selection", label_en: "Team selection and planning", label_da: "Holdudtagelse og planlægning" },
  { key: "calendar", label_en: "The season calendar and the routes", label_da: "Sæsonkalenderen og ruterne" },
  { key: "economy", label_en: "Money, sponsors and the board", label_da: "Penge, sponsorer og bestyrelsen" },
  { key: "academy", label_en: "The academy and young riders", label_da: "Akademiet og de unge ryttere" },
  { key: "inbox", label_en: "The inbox and notifications", label_da: "Indbakken og notifikationerne" },
  { key: "forum", label_en: "The forum and the community", label_da: "Forummet og fællesskabet" },
  { key: "stability", label_en: "Speed, bugs and things that break", label_da: "Hastighed, fejl og ting der går i stykker" },
];

const PRO = [
  { key: "compare", label_en: "Deep rider comparison tools", label_da: "Grundig sammenligning af ryttere" },
  { key: "analytics", label_en: "Advanced statistics and analytics", label_da: "Avanceret statistik og analyse" },
  { key: "history", label_en: "Extended history and palmares", label_da: "Udvidet historik og palmares" },
  { key: "looks", label_en: "Team looks: kit, logo, rider portraits", label_da: "Holdets udseende: trøje, logo, rytterportrætter" },
  { key: "renaming", label_en: "Renaming riders, from an approved name list", label_da: "Omdøbning af ryttere, fra en godkendt navneliste" },
  { key: "badge", label_en: "A badge on your profile", label_da: "Et mærke på din profil" },
  { key: "early_access", label_en: "See new features before everyone else", label_da: "Se nye funktioner før alle andre" },
  { key: "nothing", label_en: "Nothing extra, I would just be backing the project", label_da: "Ikke noget ekstra, jeg ville bare bakke projektet op" },
];

const INVITE_FRIEND = [
  { key: "reward_both", label_en: "A reward for both of us, for example Pro for a period", label_da: "En belønning til os begge, for eksempel Pro i en periode" },
  { key: "private_league", label_en: "A private league or group where I play against my friends", label_da: "En privat liga eller gruppe hvor jeg spiller mod mine venner" },
  { key: "duel", label_en: "A head to head duel against a friend", label_da: "En direkte duel mod en ven" },
  { key: "easier_start", label_en: "An easier start for beginners, so I do not have to explain everything", label_da: "En nemmere start for begyndere, så jeg ikke skal forklare alt" },
  { key: "share_link", label_en: "A link I can just send", label_da: "Et link jeg bare kan sende" },
  { key: "already_do", label_en: "Nothing, I already invite people", label_da: "Ingenting, jeg inviterer allerede" },
  { key: "nobody", label_en: "I do not know anyone who would play", label_da: "Jeg kender ingen der ville spille" },
];

const q = (sort_order, key, kind, label_en, label_da, extra = {}) => ({
  id: `sq-${key}`,
  survey_id: SEED_SURVEY.id,
  sort_order,
  key,
  kind,
  label_en,
  label_da,
  help_en: null,
  help_da: null,
  options: null,
  required: false,
  ...extra,
});

const DONT_KNOW_HELP_EN =
  "First: how good an idea is this for the game, no matter whether you would use it yourself. " +
  "Second: how much it matters to you right now. Pick “Do not know” if you have no view.";
const DONT_KNOW_HELP_DA =
  "Først: hvor god en idé er det for spillet, uanset om du selv ville bruge det. " +
  "Dernæst: hvor meget det betyder for dig lige nu. Vælg “Ved ikke” hvis du ikke har en mening.";
const PRO_HELP_EN =
  "Pro is optional and always will be. The game must be fair for everyone. You cannot pay for " +
  "better riders, faster training, or better results. So this is about what else Pro could hold.";
const PRO_HELP_DA =
  "Pro er valgfrit og bliver ved med at være det. Spillet skal være lige for alle. Du kan ikke " +
  "betale dig til bedre ryttere, hurtigere træning eller bedre resultater. Så spørgsmålet her er " +
  "hvad Pro ellers kunne indeholde.";

export const SEED_SURVEY_QUESTIONS = [
  q(10, "satisfaction", "scale_1_5",
    "All in all, how satisfied are you with Cycling Zone right now?",
    "Alt i alt, hvor tilfreds er du med Cycling Zone lige nu?",
    { required: true }),
  q(20, "feature_axes", "idea_importance",
    "Rate each idea twice.",
    "Giv hver idé to karakterer.",
    { help_en: DONT_KNOW_HELP_EN, help_da: DONT_KNOW_HELP_DA, options: FEATURES }),
  q(30, "works_worst", "multi_max3",
    "Which parts of the game work worst today? Pick up to three.",
    "Hvilke dele af spillet fungerer dårligst i dag? Vælg op til tre.",
    { options: WORST, required: true }),
  q(40, "works_worst_detail", "text",
    "What exactly goes wrong there? The more concrete, the better.",
    "Hvad går præcist galt der? Jo mere konkret, jo bedre."),
  q(50, "one_thing", "text",
    "If I could only build one thing in the next month, what should it be?",
    "Hvis jeg kun kunne bygge én ting den næste måned, hvad skulle det så være?",
    { required: true }),
  q(60, "play_more", "text",
    "What would make you play more than you do now?",
    "Hvad ville få dig til at spille mere end du gør nu?"),
  q(70, "invite_friend", "multi",
    "What would make you invite a friend to join? Pick as many as you like.",
    "Hvad ville få dig til at invitere en ven med? Vælg lige så mange du vil.",
    { options: INVITE_FRIEND }),
  q(80, "pro_contents", "multi",
    "What would belong in Pro, if you got to decide? Pick as many as you like.",
    "Hvad hører hjemme i Pro, hvis du bestemte? Vælg lige så mange du vil.",
    { help_en: PRO_HELP_EN, help_da: PRO_HELP_DA, options: PRO }),
  q(90, "pro_exclusions", "text",
    "Is there anything that should stay out of Pro? Tell me what, and why.",
    "Er der noget der ikke skal ind i Pro? Skriv hvad, og hvorfor."),
  q(100, "pro_would_pay", "single",
    "Would you pay for Pro with the things you picked above?",
    "Ville du betale for Pro med det du valgte ovenfor?",
    {
      required: true,
      options: [
        { key: "yes", label_en: "Yes", label_da: "Ja" },
        { key: "maybe", label_en: "Maybe", label_da: "Måske" },
        { key: "no", label_en: "No", label_da: "Nej" },
        { key: "already", label_en: "I already do", label_da: "Det gør jeg allerede" },
      ],
    }),
  q(110, "follow_up", "yes_no",
    "May I come back to you about your answers?",
    "Må jeg vende tilbage til dig om dine svar?"),
];

/**
 * Overlejrer skemaets fire tabeller på en Playwright-side. Registreres EFTER
 * installNetworkMocks, så disse routes vinder (Playwright matcher LIFO).
 *
 * `isAdmin` spejler RLS'en i database/2026-09-07-4943-in-app-survey.sql: en
 * admin kan laese BAADE kladde-skemaet og dets spoergsmaal, alle andre kan kun
 * laese spoergsmaalene mens skemaet er aabent. Det er dét der goer
 * kladde-preview-tilstanden (#4943) testbar uden prod-login.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ status?: string, completed?: boolean, responses?: object[], isAdmin?: boolean }} options
 */
export async function installSurveyRoutes(
  page,
  { status = "open", completed = false, responses = [], isAdmin = false } = {}
) {
  const survey = { ...SEED_SURVEY, status };
  const body = (data) => ({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  const single = (request) => (request.headers().accept || "").includes("vnd.pgrst.object");

  await page.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill(body(isAdmin)));

  await page.route(/\/rest\/v1\/surveys/, (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fulfill(body({}));
    return route.fulfill(body(single(request) ? survey : [survey]));
  });

  await page.route(/\/rest\/v1\/survey_questions/, (route) =>
    route.fulfill(body(status === "open" || isAdmin ? SEED_SURVEY_QUESTIONS : []))
  );

  await page.route(/\/rest\/v1\/survey_responses/, (route) => {
    const request = route.request();
    // DELETE svarer 204 som PostgREST, ikke 200 med en tom liste: mocken maa
    // ikke faa en sletning der i virkeligheden blev blokeret af RLS til at
    // ligne en succes (CodeRabbit-review paa #4943).
    if (request.method() === "DELETE") return route.fulfill({ status: 204, body: "" });
    if (request.method() !== "GET") return route.fulfill(body([]));
    return route.fulfill(body(responses));
  });

  await page.route(/\/rest\/v1\/survey_completions/, (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fulfill(body([]));
    const row = completed ? { survey_id: survey.id, completed_at: "2026-09-08T09:00:00Z" } : null;
    return route.fulfill(body(single(request) ? row : row ? [row] : []));
  });
}
