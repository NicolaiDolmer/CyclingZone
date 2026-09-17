// Dansk oversaettelses-bundle — Refs #5177.
//
// Denne fil importeres KUN dynamisk (`import("./messages.da.js")` i
// localeBundleBackend.js), saa Rollup laegger den i sin egen chunk
// (`i18n-messages-da`, se codeSplitting-grupperne i vite.config.js).
//
// Hvorfor: indtil #5177 laa BEGGE sprog inline i `resources` i index.js — 24
// namespaces x en+da, 426 KB raat / 131 KB gzippet — og hele blokken var en
// STATISK import fra entry'en. Hver eneste besoegende hentede altsaa ogsaa det
// sprog de aldrig ser. Engelsk bliver liggende inline (det er baade default og
// `fallbackLng`, saa det skal vaere der uanset hvad); dansk hentes kun naar
// dansk faktisk er det valgte sprog.
//
// Listen skal holdes i synk med `resources.en` i index.js — det er praecis de
// namespaces der ikke maa lazy-loades efter first paint (#411/#412/#470), og
// `scripts/i18n-check-keys.mjs` + `scripts/i18n-check-namespace-inline.mjs`
// haandhaever begge sider. De route-gatede namespaces (INLINE_EXEMPT) hoerer
// IKKE til her; de loades fortsat via HttpBackend paa begge sprog.

import common from "../../public/locales/da/common.json";
import auth from "../../public/locales/da/auth.json";
import errors from "../../public/locales/da/errors.json";
import auctions from "../../public/locales/da/auctions.json";
import transfers from "../../public/locales/da/transfers.json";
import dashboard from "../../public/locales/da/dashboard.json";
import banners from "../../public/locales/da/banners.json";
import feedback from "../../public/locales/da/feedback.json";
import rider from "../../public/locales/da/rider.json";
import riders from "../../public/locales/da/riders.json";
import riderFilters from "../../public/locales/da/riderFilters.json";
import riderTypes from "../../public/locales/da/riderTypes.json";
import team from "../../public/locales/da/team.json";
import finance from "../../public/locales/da/finance.json";
import sponsor from "../../public/locales/da/sponsor.json";
import headtohead from "../../public/locales/da/headtohead.json";
import halloffame from "../../public/locales/da/halloffame.json";
import races from "../../public/locales/da/races.json";
import training from "../../public/locales/da/training.json";
import academy from "../../public/locales/da/academy.json";
import klub from "../../public/locales/da/klub.json";
import staff from "../../public/locales/da/staff.json";
import landing from "../../public/locales/da/landing.json";
import globalRank from "../../public/locales/da/globalRank.json";

export default {
  common,
  auth,
  errors,
  auctions,
  transfers,
  dashboard,
  banners,
  feedback,
  rider,
  riders,
  riderFilters,
  riderTypes,
  team,
  finance,
  sponsor,
  headtohead,
  halloffame,
  races,
  training,
  academy,
  klub,
  staff,
  landing,
  globalRank,
};
