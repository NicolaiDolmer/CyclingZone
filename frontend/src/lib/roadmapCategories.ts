// Ejerens fælles roadmap-taksonomi (#8584). Engine er den gamle DB-gruppering.
export const ROADMAP_CATEGORIES = [
  { key: "races", label: "Løb", en: "Races", engine: "races" },
  { key: "tactics", label: "Taktik", en: "Tactics", engine: "races" },
  { key: "selection", label: "Holdudtagelse & planlægning", en: "Team selection & planning", engine: "races" },
  { key: "training", label: "Træning", en: "Training", engine: "training" },
  { key: "development", label: "Udvikling", en: "Development", engine: "training" },
  { key: "form", label: "Form, træthed & skader", en: "Form, fatigue & injuries", engine: "training" },
  { key: "academy", label: "Akademi & ungdom", en: "Academy & youth", engine: "youth" },
  { key: "market", label: "Transfermarked & scouting", en: "Transfer market & scouting", engine: "market" },
  { key: "club", label: "Klub & økonomi", en: "Club & finances", engine: "club" },
  { key: "board_sponsors", label: "Bestyrelse & sponsorer", en: "Board & sponsors", engine: "club" },
  { key: "staff", label: "Stab & assistent", en: "Staff & assistant", engine: "club" },
  { key: "rider_profile", label: "Rytterprofil & historik", en: "Rider profile & history", engine: "club" },
  { key: "calendar", label: "Kalender, ranglister & sæson", en: "Calendar, rankings & season", engine: "club" },
  { key: "social", label: "Fællesskab", en: "Community", engine: "club" },
  { key: "app", label: "App, mobil & hjælp", en: "App, mobile & help", engine: "club" },
  { key: "growth", label: "Vækst & markedsføring", en: "Growth & marketing", engine: "club", internal: true },
];
