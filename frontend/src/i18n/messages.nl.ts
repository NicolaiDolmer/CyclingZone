// Hollandsk oversaettelses-bundle (skjult beta-sprog) — Refs #6836.
//
// Samme form som messages.da.js: importeres KUN dynamisk fra
// localeBundleBackend.js, saa Rollup laegger den i sin egen chunk
// (`i18n-messages-nl`, se codeSplitting-grupperne i vite.config.js) og
// EN/DA-bundlen aldrig vokser. Listen skal holdes i synk med messages.da.js
// (= `resources.en` i index.js); route-gatede INLINE_EXEMPT-namespaces
// loades fortsat via HttpBackend. Beta-sproget preloades aldrig
// (vite-plugins/i18n-lang-preload.js) og vises kun for ejer + beta-testere.

import common from "../../public/locales/nl/common.json";
import auth from "../../public/locales/nl/auth.json";
import errors from "../../public/locales/nl/errors.json";
import auctions from "../../public/locales/nl/auctions.json";
import transfers from "../../public/locales/nl/transfers.json";
import dashboard from "../../public/locales/nl/dashboard.json";
import banners from "../../public/locales/nl/banners.json";
import feedback from "../../public/locales/nl/feedback.json";
import rider from "../../public/locales/nl/rider.json";
import riders from "../../public/locales/nl/riders.json";
import riderFilters from "../../public/locales/nl/riderFilters.json";
import riderTypes from "../../public/locales/nl/riderTypes.json";
import team from "../../public/locales/nl/team.json";
import finance from "../../public/locales/nl/finance.json";
import sponsor from "../../public/locales/nl/sponsor.json";
import headtohead from "../../public/locales/nl/headtohead.json";
import halloffame from "../../public/locales/nl/halloffame.json";
import races from "../../public/locales/nl/races.json";
import training from "../../public/locales/nl/training.json";
import academy from "../../public/locales/nl/academy.json";
import klub from "../../public/locales/nl/klub.json";
import staff from "../../public/locales/nl/staff.json";
import landing from "../../public/locales/nl/landing.json";
import globalRank from "../../public/locales/nl/globalRank.json";

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
