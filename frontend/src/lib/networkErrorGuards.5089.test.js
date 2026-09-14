// #5089 — reportUnauthorizedResponse: ét dispatch pr. "session er død"-episode.
//
// Egen fil (ikke networkErrorGuards.test.js, som allerede dækker #3628's
// stuck-loading-handlere og er urelateret til denne 401-guard) — samme
// nummererede-testfil-konvention som sessionRejection.4350.test.js og
// deadClickGuard3012.test.js.
//
// Fake-clienten injiceres i stedet for at mocke Supabase-modulet — samme
// mønster som getAuthedUser.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { reportUnauthorizedResponse, _resetForTests } from "./networkErrorGuards.js";

function fakeClient({ sessionToken = "tok-1", deniedByUser = true, getUserThrows = false, renewDuringGetUser = null } = {}) {
  const state = { signOutCalls: 0, getUserCalls: 0, sessionToken };
  state.client = {
    auth: {
      // `sessionToken` læses fra `state` ved HVERT kald (ikke closure'et ved
      // oprettelse) — så en test kan simulere et re-login midt i sekvensen,
      // eller en fornyelse midt i getUser()'s netværkskald, uden en ny client.
      getSession: async () => ({
        data: { session: state.sessionToken ? { access_token: state.sessionToken } : null },
      }),
      getUser: async () => {
        state.getUserCalls += 1;
        if (getUserThrows) throw new Error("network down");
        // TOCTOU-simulation (CodeRabbit-fund, #5089): sessionen fornyer sig
        // MENS dette (langsomme) netværkskald er undervejs.
        if (renewDuringGetUser) state.sessionToken = renewDuringGetUser;
        return deniedByUser
          ? { data: { user: null }, error: { status: 401 } }
          : { data: { user: { id: "u1" } }, error: null };
      },
      signOut: async () => {
        state.signOutCalls += 1;
        state.sessionToken = null; // spejler den ægte klients adfærd
      },
    },
  };
  return state;
}

const res401 = { status: 401 };
const headers = { Authorization: "Bearer tok-1" };

test.beforeEach(() => _resetForTests());

test("en 403 rører aldrig sessionen (kun 401 tæller som afvisning, #4350-skellet)", async () => {
  const state = fakeClient();
  const result = await reportUnauthorizedResponse({ status: 403 }, headers, "test", state.client);
  assert.equal(result, false);
  assert.equal(state.signOutCalls, 0);
});

test("et 401 der bekræftes af Supabase logger ud ÉN gang", async () => {
  const state = fakeClient();
  const result = await reportUnauthorizedResponse(res401, headers, "test-A", state.client);
  assert.equal(result, true);
  assert.equal(state.signOutCalls, 1);
});

test("N samtidige 401'er deler ÉT Supabase-opslag, ikke N (23x401-loopet)", async () => {
  const state = fakeClient();
  const results = await Promise.all([
    reportUnauthorizedResponse(res401, headers, "a", state.client),
    reportUnauthorizedResponse(res401, headers, "b", state.client),
    reportUnauthorizedResponse(res401, headers, "c", state.client),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(state.signOutCalls, 1, "signOut skal kun kaldes én gang for de samtidige kald");
  assert.equal(state.getUserCalls, 1, "kun ÉT opslag mod Supabase for hele bygen");
});

test("efter sessionen er erklæret død, spørger senere 401'er (samme døde session) ALDRIG Supabase igen", async () => {
  const state = fakeClient();
  await reportUnauthorizedResponse(res401, headers, "first", state.client);
  assert.equal(state.signOutCalls, 1);
  assert.equal(state.getUserCalls, 1);
  // Simulerer #5089's faktiske bug: flere SEKVENTIELLE (ikke samtidige) 401'er
  // spredt over tid, mens sessionen forbliver væk.
  for (let i = 0; i < 5; i += 1) {
    const later = await reportUnauthorizedResponse(res401, headers, `later-${i}`, state.client);
    assert.equal(later, true, "en sticky 'allerede erklæret død'-tilstand skal svare true uden ny forespørgsel");
  }
  assert.equal(state.signOutCalls, 1, "signOut må ikke kaldes igen for et allerede afgjort udfald");
  assert.equal(state.getUserCalls, 1, "Supabase må ikke spørges igen — det er selve 23x401-kuren");
});

test("et RE-LOGIN nulstiller låsen — en ny session skal kunne erklæres død igen (uden en full-reload)", async () => {
  const state = fakeClient();
  await reportUnauthorizedResponse(res401, headers, "first-session-dies", state.client);
  assert.equal(state.signOutCalls, 1);
  assert.equal(state.getUserCalls, 1);

  // Spilleren logger ind igen — react-router's navigate(), ingen full reload,
  // så modulets tilstand overlever i browseren. Uden token-sammenligningen ville
  // guarden stå fast i "død" for evigt.
  state.sessionToken = "tok-2";
  const newHeaders = { Authorization: "Bearer tok-2" };
  const result = await reportUnauthorizedResponse(res401, newHeaders, "second-session-dies", state.client);
  assert.equal(result, true, "den NYE sessions 401 skal også blive erklæret død");
  assert.equal(state.signOutCalls, 2, "signOut skal køre igen for den nye, uafhængige episode");
  assert.equal(state.getUserCalls, 2, "en frisk session betyder en frisk — ægte — forespørgsel til Supabase");
});

test("et 401 der IKKE bekræftes af Supabase (fornyelses-race) rører ikke sessionen", async () => {
  const state = fakeClient({ deniedByUser: false });
  const result = await reportUnauthorizedResponse(res401, headers, "renewal-race", state.client);
  assert.equal(result, false);
  assert.equal(state.signOutCalls, 0);
});

test("401 for et token sessionen allerede har skiftet væk fra ignoreres (fornyelses-race)", async () => {
  const state = fakeClient({ sessionToken: "tok-2" }); // sessionen har fornyet SIDEN kaldet blev sendt
  const result = await reportUnauthorizedResponse(res401, headers, "stale-token", state.client);
  assert.equal(result, false);
  assert.equal(state.signOutCalls, 0);
});

test("ingen session tilbage overhovedet → 401'en er sandheden, log ud", async () => {
  const state = fakeClient({ sessionToken: null });
  const result = await reportUnauthorizedResponse(res401, headers, "no-session", state.client);
  assert.equal(result, true);
  assert.equal(state.signOutCalls, 1);
});

test("kunne slet ikke spørge Supabase (netværksudfald) → rør ikke sessionen", async () => {
  const state = fakeClient({ getUserThrows: true });
  const result = await reportUnauthorizedResponse(res401, headers, "network-down", state.client);
  assert.equal(result, false);
  assert.equal(state.signOutCalls, 0);
});

test("to samtidige 401'er for FORSKELLIGE tokens afgøres HVER for sig, ikke af et globalt lås (CodeRabbit-fund)", async () => {
  // Sessionen er allerede fornyet til tok-B da bygen rammer — men en sen
  // fetch der blev afsendt FØR fornyelsen lander stadig med tok-A i sin 401.
  const state = fakeClient({ sessionToken: "tok-B" });
  const headersOld = { Authorization: "Bearer tok-A" };
  const headersNew = { Authorization: "Bearer tok-B" };
  const [resultOld, resultNew] = await Promise.all([
    reportUnauthorizedResponse(res401, headersOld, "stale-request", state.client),
    reportUnauthorizedResponse(res401, headersNew, "current-request", state.client),
  ]);
  assert.equal(resultOld, false, "401'en for det GAMLE token er en fornyelses-race, ikke en død session");
  assert.equal(resultNew, true, "401'en for det AKTUELLE token skal stadig blive erklæret død selvstændigt");
  assert.equal(state.signOutCalls, 1, "kun ÉN reel afvisning fandt sted, og den skal stadig udløse signOut");
});

test("sessionen fornyer sig MENS getUser() er undervejs → ingen signOut (TOCTOU, CodeRabbit-fund)", async () => {
  const state = fakeClient({ sessionToken: "tok-dead", renewDuringGetUser: "tok-fresh" });
  const headersDead = { Authorization: "Bearer tok-dead" };
  const result = await reportUnauthorizedResponse(res401, headersDead, "toctou", state.client);
  assert.equal(result, false, "en sen bekræftelse af en gammel 401 må ikke rydde en session der blev frisk undervejs");
  assert.equal(state.signOutCalls, 0);
});
