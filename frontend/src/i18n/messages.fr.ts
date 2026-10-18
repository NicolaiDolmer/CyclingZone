// Fransk oversaettelses-bundle (skjult beta-sprog) — Refs #6836.
//
// Samme form som messages.da.js: importeres KUN dynamisk fra
// localeBundleBackend.js, saa Rollup laegger den i sin egen chunk
// (`i18n-messages-fr`, se codeSplitting-grupperne i vite.config.js) og
// EN/DA-bundlen aldrig vokser. Listen skal holdes i synk med messages.da.js
// (= `resources.en` i index.js); route-gatede INLINE_EXEMPT-namespaces
// loades fortsat via HttpBackend. Beta-sproget preloades aldrig
// (vite-plugins/i18n-lang-preload.js) og vises kun for ejer + beta-testere.

import common from "../../public/locales/fr/common.json";
import auth from "../../public/locales/fr/auth.json";
import errors from "../../public/locales/fr/errors.json";
import auctions from "../../public/locales/fr/auctions.json";
import transfers from "../../public/locales/fr/transfers.json";
import dashboard from "../../public/locales/fr/dashboard.json";
import banners from "../../public/locales/fr/banners.json";
import feedback from "../../public/locales/fr/feedback.json";
import rider from "../../public/locales/fr/rider.json";
import riders from "../../public/locales/fr/riders.json";
import riderFilters from "../../public/locales/fr/riderFilters.json";
import riderTypes from "../../public/locales/fr/riderTypes.json";
import team from "../../public/locales/fr/team.json";
import finance from "../../public/locales/fr/finance.json";
import sponsor from "../../public/locales/fr/sponsor.json";
import headtohead from "../../public/locales/fr/headtohead.json";
import halloffame from "../../public/locales/fr/halloffame.json";
import races from "../../public/locales/fr/races.json";
import training from "../../public/locales/fr/training.json";
import academy from "../../public/locales/fr/academy.json";
import klub from "../../public/locales/fr/klub.json";
import staff from "../../public/locales/fr/staff.json";
import landing from "../../public/locales/fr/landing.json";
import globalRank from "../../public/locales/fr/globalRank.json";

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
