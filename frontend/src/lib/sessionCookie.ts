// #4067 — ikke-følsom, klient-sat markør-cookie: "har denne browser en (formentlig)
// aktiv session lige nu". Indeholder INGEN token/PII, kun "1"/fraværende. Bruges
// udelukkende af frontend/vercel.json's "missing"-cookie-rewrite på "/", så en
// anonym besøgende ser marketing-forsiden, mens en logget-ind spiller (cookien
// er sat) fortsat får SPA'en (og dermed App.jsx's egen /dashboard-redirect).
//
// Sat/ryddet fra App.jsx's onAuthStateChange + initial getSession() — ALDRIG fra
// selve Supabase-sessionen direkte, da Supabase-tokenet bor i localStorage og
// ikke må lække til en cookie (den er læsbar af enhver script på domænet).
//
// Lang levetid (400 dage, samme orden som Supabase refresh-token-vinduet i
// praksis) og fornyes ved hvert vellykket session-tjek, så cookien ikke udløber
// midt i et aktivt spilforløb og midlertidigt sender en logget-ind spiller om på
// marketing-forsiden (de lander stadig rigtigt efter App.jsx hydrerer og omdirigerer
// til /dashboard — men SEO-fordelen ved ét afsenderpunkt ('/') bevares bedst hvis
// cookien er frisk).
const COOKIE_NAME = "cz_session";
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function isBrowser() {
  return typeof document !== "undefined";
}

export function setSessionCookie() {
  if (!isBrowser()) return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  if (!isBrowser()) return;
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
