// Spansk oversaettelses-bundle (skjult beta-sprog) — Refs #6836.
//
// Samme form som messages.da.js: importeres KUN dynamisk fra
// localeBundleBackend.js, saa Rollup laegger den i sin egen chunk
// (`i18n-messages-es`, se codeSplitting-grupperne i vite.config.js) og
// EN/DA-bundlen aldrig vokser. Listen skal holdes i synk med messages.da.js
// (= `resources.en` i index.js); route-gatede INLINE_EXEMPT-namespaces
// loades fortsat via HttpBackend. Beta-sproget preloades aldrig
// (vite-plugins/i18n-lang-preload.js) og vises kun for ejer + beta-testere.

import common from "../../public/locales/es/common.json";
import auth from "../../public/locales/es/auth.json";
import errors from "../../public/locales/es/errors.json";
import auctions from "../../public/locales/es/auctions.json";
import transfers from "../../public/locales/es/transfers.json";
import dashboard from "../../public/locales/es/dashboard.json";
import banners from "../../public/locales/es/banners.json";
import feedback from "../../public/locales/es/feedback.json";
import rider from "../../public/locales/es/rider.json";
import riders from "../../public/locales/es/riders.json";
import riderFilters from "../../public/locales/es/riderFilters.json";
import riderTypes from "../../public/locales/es/riderTypes.json";
import team from "../../public/locales/es/team.json";
import finance from "../../public/locales/es/finance.json";
import sponsor from "../../public/locales/es/sponsor.json";
import headtohead from "../../public/locales/es/headtohead.json";
import halloffame from "../../public/locales/es/halloffame.json";
import races from "../../public/locales/es/races.json";
import training from "../../public/locales/es/training.json";
import academy from "../../public/locales/es/academy.json";
import klub from "../../public/locales/es/klub.json";
import staff from "../../public/locales/es/staff.json";
import landing from "../../public/locales/es/landing.json";
import globalRank from "../../public/locales/es/globalRank.json";

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
