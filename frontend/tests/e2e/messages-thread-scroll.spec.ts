// #5313 — Beskedtråden skal åbne ved den NYESTE besked, ikke ved toppen
// (ældste), og skal bevare brugerens scrollposition hvis vedkommende selv har
// rullet op for at læse historik.
//
// `installMessagesMocks` seeder normalt kun 3 beskeder (fixtures.js) — nok til
// resten af DM-suiten (3200-manager-dm.spec.js), men ikke nok til at bevise
// noget om scroll, fordi 3 korte beskeder aldrig fylder traad-containerens
// `max-h-[52vh]` og overflower den. Denne spec skubber selv 27 beskeder mere
// ind i den samme muterbare mock-state (samme mønster som `state.sent` i
// fixtures.js), så traaden reelt skal rulle for at vise den nyeste.

import type { Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  installMessagesMocks,
  login,
  stabilizePage,
} from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

// Den muterbare mock-state fra installMessagesMocks (fixtures.js er utypet).
type MessagesMockState = {
  conversations: Array<{ id: string }>;
  messages: Array<Record<string, unknown>>;
};

const thread = (page: Page) => page.getByTestId("dm-thread-messages");

// Fylder samtalen op til 30 beskeder i alt (3 seedede + 27 her), kronologisk
// efter de tre seedede fra 2026-09-07. `fromMe` alternerer, så bobler ligger
// begge veje ligesom i en rigtig tråd.
function seedThirtyMessages(state: MessagesMockState) {
  const CONVERSATION_ID = state.conversations[0].id;
  const base = Date.parse("2026-09-07T11:00:00.000Z");
  for (let i = 4; i <= 30; i += 1) {
    state.messages.push({
      id: `dm-msg-${i}`,
      conversationId: CONVERSATION_ID,
      fromMe: i % 2 === 0,
      body: `Message ${i} in the negotiation thread.`,
      createdAt: new Date(base + i * 60_000).toISOString(),
      context: null,
    });
  }
}

test("traad med 30 beskeder aabner med den nyeste besked synlig", async ({ page }) => {
  const state = await installMessagesMocks(page);
  seedThirtyMessages(state);
  await login(page);

  await page.goto("/notifications?tab=messages&c=dm-conv-1");

  const newest = thread(page).getByText("Message 30 in the negotiation thread.");
  const oldest = thread(page).getByText(/Are you open to selling Vandenberg/);

  // Den nyeste besked skal vaere synlig UDEN at brugeren selv skal rulle -
  // det er selve reproet paa #5313 ("aabner i toppen i stedet for ved bunden").
  await expect(newest).toBeInViewport();
  // Og modsat: den aeldste besked (traadens allerfoerste) skal IKKE staa i
  // det synlige omraade, ellers beviser testen intet om at der reelt blev
  // rullet (containeren kunne bare vaere hoej nok til at vise alt).
  await expect(oldest).not.toBeInViewport();
});

test("bevarer scroll-positionen naar en ny besked ankommer via polling, hvis brugeren selv har rullet op", async ({ page }) => {
  // Traadens polling koerer hvert 20. sekund (THREAD_POLL_MS i MessagesPanel.jsx).
  // Fake ur i stedet for at vente 20+ reelle sekunder pr. testkoersel.
  await page.clock.install();

  const state = await installMessagesMocks(page);
  seedThirtyMessages(state);
  await login(page);

  await page.goto("/notifications?tab=messages&c=dm-conv-1");
  await expect(thread(page).getByText("Message 30 in the negotiation thread.")).toBeInViewport();

  // Brugeren ruller selv op for at laese historik.
  const oldest = thread(page).getByText(/Are you open to selling Vandenberg/);
  await oldest.scrollIntoViewIfNeeded();
  await expect(oldest).toBeInViewport();

  // En ny besked ankommer FRA modparten (mock-state, som en rigtig poll ville se).
  state.messages.push({
    id: "dm-msg-poll-1",
    conversationId: state.conversations[0].id,
    fromMe: false,
    body: "One more thing before we close this.",
    createdAt: new Date().toISOString(),
    context: null,
  });
  await page.clock.fastForward(21_000); // trigger pollingens setInterval

  await expect(thread(page).getByText("One more thing before we close this.")).toBeVisible();
  // Traaden maa IKKE selv have hoppet ned til bunden - brugeren laeser stadig
  // historikken (#5313: "bevarer positionen hvis brugeren selv har rullet op").
  await expect(oldest).toBeInViewport();
});

// ---------------------------------------------------------------------------
// Efter ejer-review 23/9: aabnet via DIREKTE LINK (som fra en notifikation om
// en ny besked) stod traaden stadig ved den AELDSTE besked, mens et klik i
// samtalelisten virkede. Testene ovenfor fangede det ikke, fordi mock-svarene
// kommer med det samme og i en fast raekkefoelge.
//
// Rod-aarsagen: panelet viser et skelet saa laenge SAMTALELISTEN henter. Ved et
// direkte link hentes listen og traaden parallelt; svarer traaden foerst, koerer
// scroll-effekten mens scroll-containeren endnu ikke findes, og naar listen
// senere kommer og containeren monteres, er der ingen ny besked til at udloese
// effekten igen. Ved et klik i listen er listen allerede hentet, derfor virkede
// det. Testene herunder forsinker hver sit svar, saa begge raekkefoelger er
// daekket.

const OWNER_NEWEST = "Deal at 165k. Sending the offer now.";

// Ejerens tilfaelde: 7 beskeder hvor nogle er lange (3 seedede + 4 her).
function seedOwnerReviewThread(state: MessagesMockState) {
  const CONVERSATION_ID = state.conversations[0].id;
  const base = Date.parse("2026-09-07T11:00:00.000Z");
  const long = (lead: string) => `${lead} ${"I have been going through the numbers again, and the wage bill for next season is the part that worries me most, because the sponsor money only lands after the spring classics. ".repeat(3)}`.trim();
  const bodies = [
    long("Budget checked."),
    long("Understood, but"),
    long("One more angle:"),
    OWNER_NEWEST,
  ];
  bodies.forEach((body, index) => {
    state.messages.push({
      id: `dm-msg-owner-${index + 4}`,
      conversationId: CONVERSATION_ID,
      fromMe: index % 2 === 1,
      body,
      createdAt: new Date(base + index * 60_000).toISOString(),
      context: null,
    });
  });
}

// Holder GET-svarene tilbage i `ms` og lader dem saa gaa videre til
// installMessagesMocks (senest registrerede route koerer foerst i Playwright,
// `fallback` sender videre til den naeste).
async function delayGet(page: Page, matches: (url: URL) => boolean, ms: number) {
  await page.route(matches, async (route: Route) => {
    if (route.request().method() === "GET") {
      await new Promise((resolve) => { setTimeout(resolve, ms); });
    }
    await route.fallback();
  });
}

const isConversationList = (url: URL) => url.pathname.endsWith("/api/messages/conversations");
const isThreadFetch = (url: URL) => /\/api\/messages\/conversations\/[^/]+$/.test(url.pathname);

for (const variant of [
  { slow: "samtalelisten", matches: isConversationList },
  { slow: "traaden", matches: isThreadFetch },
]) {
  test(`direkte link aabner ved nyeste besked naar ${variant.slow} svarer 800 ms forsinket`, async ({ page }) => {
    const state = await installMessagesMocks(page);
    seedOwnerReviewThread(state);
    await delayGet(page, variant.matches, 800);
    await login(page);

    await page.goto("/notifications?tab=messages&c=dm-conv-1");

    const newest = thread(page).getByText(OWNER_NEWEST);
    const oldest = thread(page).getByText(/Are you open to selling Vandenberg/);
    await expect(newest).toBeInViewport();
    await expect(oldest).not.toBeInViewport();
  });
}

test("bliver ved nyeste besked naar beskederne vokser i hoejden efter foerste render", async ({ page }) => {
  const state = await installMessagesMocks(page);
  seedOwnerReviewThread(state);
  await login(page);

  await page.goto("/notifications?tab=messages&c=dm-conv-1");
  const newest = thread(page).getByText(OWNER_NEWEST);
  await expect(newest).toBeInViewport();

  // Samme klasse som en webfont der loader efter foerste render og ombryder de
  // lange beskeder: hver boble bliver hoejere, uden at der kommer en ny besked.
  await page.addStyleTag({ content: '[data-testid="dm-thread-messages"] > li { padding-bottom: 120px; }' });

  await expect(newest).toBeInViewport();
});
