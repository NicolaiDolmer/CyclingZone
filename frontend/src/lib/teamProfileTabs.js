// #3916: holdsidens ("andres hold"-visning, TeamProfilePage.jsx) fane-valg
// skal altid starte paa trup ("squad") medmindre URL'en eksplicit peger paa
// en anden gyldig fane (?tab=...). Ren funktion saa reglen kan testes uden
// at rendere komponenten (node --test importerer ikke .jsx uden en loader —
// samme begraensning som resten af frontend/src/lib).
//
// Bruges to steder i TeamProfilePage.jsx: (a) initial state ved mount, og
// (b) en effekt der nulstiller faneden naar `id`-route-param'et skifter —
// React Router genbruger komponent-instansen ved navigation mellem to
// forskellige holds /teams/:id-sider (samme route, andet param), saa uden
// (b) "laekker" den forrige holds fane-valg ind paa det nye hold.
export const TEAM_PROFILE_TABS = ["squad", "results", "palmares", "transfers", "club"];

export function resolveTeamProfileTab(tabParam) {
  return TEAM_PROFILE_TABS.includes(tabParam) ? tabParam : "squad";
}
