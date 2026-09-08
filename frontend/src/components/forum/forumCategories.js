// #4818 · Forum-kategoriernes raekkefoelge og skrive-rettigheder.
//
// Ejer-direktiv 4/9 (ordret): "Inde paa forummet vil jeg have en
// roadmap/roadbook kategori... Skal kun vaere mig, der kan slaa noget op det
// sted i forummet." Ejer-afklaring 8/9: "kun jeg opretter, alle svarer."
//
// Rettigheden er GENEREL (en rolle pr. kategori), ikke et hardcodet bruger-id,
// saa #4268's rollemodel kan udvide den uden at roere fladen. Sandheden om
// rettigheden ligger i databasen (public.forum_category_post_roles, haandhaevet
// af en trigger) og gentages i backend/lib/forum.js; denne fil er UDELUKKENDE
// visnings-laget — den bestemmer hvad brugeren faar lov at forsoege, ikke hvad
// der bliver godkendt. Udvid alle tre steder sammen.
//
// Holdt uden JSX og uden React-import, saa reglerne kan koeres direkte under
// `node --test` (samme moenster som forumIdentity.js).

export const FORUM_POST_ROLE_EVERYONE = "everyone";
export const FORUM_POST_ROLE_ADMIN = "admin";

/**
 * Visningsraekkefoelgen for kategorierne — fanerraekken paa /forum OG
 * vaelgeren i compose-modalen laeser den her. `roadmap` ligger oeverst
 * (ejer-direktiv: kategorien skal vaere det foerste man ser).
 * SKAL matche FORUM_CATEGORIES i backend/lib/forum.js.
 */
export const FORUM_CATEGORY_ORDER = [
  "roadmap",
  "general",
  "feedback_ideas",
  "questions",
  "tactics",
  "transfers",
  "off_topic",
];

/** Spejler public.forum_category_post_roles. Manglende noegle = everyone. */
export const FORUM_CATEGORY_POST_ROLES = { roadmap: FORUM_POST_ROLE_ADMIN };

/** Rollen der kraeves for at OPRETTE en traad i kategorien. */
export function forumCategoryPostRole(category) {
  return FORUM_CATEGORY_POST_ROLES[category] || FORUM_POST_ROLE_EVERYONE;
}

/** Er kategorien forbeholdt ejeren? Bruges til "officielt"-maerket. */
export function isAdminOnlyCategory(category) {
  return forumCategoryPostRole(category) === FORUM_POST_ROLE_ADMIN;
}

/**
 * Maa brugeren oprette en traad i kategorien? Fail closed: alt andet end et
 * eksplicit `true` for isAdmin behandles som ikke-admin, saa en endnu ikke
 * indlaest rolle aldrig aabner en admin-kategori for et oejeblik.
 */
export function canCreateForumThread(category, { isAdmin = false } = {}) {
  return !isAdminOnlyCategory(category) || isAdmin === true;
}

/** Kategorierne brugeren rent faktisk kan vaelge i compose-modalen. */
export function postableForumCategories({ isAdmin = false } = {}) {
  return FORUM_CATEGORY_ORDER.filter((category) => canCreateForumThread(category, { isAdmin }));
}

/**
 * Skal "New post"-knappen vises paa /forum?
 *
 * Kun skjult naar man staar PAA en admin-only fane som ikke-admin: paa "All"
 * og paa alle andre faner er der stadig et sted at skrive, og en forsvundet
 * knap ville der bare vaere en blindgyde. Er kategorien tom (= "All"), er
 * svaret altid ja.
 */
export function showsNewThreadButton(category, { isAdmin = false } = {}) {
  if (!category) return true;
  return canCreateForumThread(category, { isAdmin });
}
