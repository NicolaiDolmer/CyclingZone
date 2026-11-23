// Ejerens fælles roadmap-taksonomi (#8584). Engine er den gamle DB-gruppering.
// Navnene står på alle fem sprog, så fransk, spansk og hollandsk ikke falder
// tilbage til engelsk på Plan-, Stem- og Beta-fanen.
export const ROADMAP_CATEGORIES = [
  { key: "races", label: "Løb", en: "Races", es: "Carreras", fr: "Courses", nl: "Koersen", engine: "races" },
  { key: "tactics", label: "Taktik", en: "Tactics", es: "Táctica", fr: "Tactique", nl: "Tactiek", engine: "races" },
  { key: "selection", label: "Holdudtagelse & planlægning", en: "Team selection & planning", es: "Selección y planificación", fr: "Sélection et planification", nl: "Ploegselectie & planning", engine: "races" },
  { key: "training", label: "Træning", en: "Training", es: "Entrenamiento", fr: "Entraînement", nl: "Training", engine: "training" },
  { key: "development", label: "Udvikling", en: "Development", es: "Desarrollo", fr: "Progression", nl: "Ontwikkeling", engine: "training" },
  { key: "form", label: "Form, træthed & skader", en: "Form, fatigue & injuries", es: "Forma, fatiga y lesiones", fr: "Forme, fatigue et blessures", nl: "Vorm, vermoeidheid & blessures", engine: "training" },
  { key: "academy", label: "Akademi & ungdom", en: "Academy & youth", es: "Academia y cantera", fr: "Académie et jeunes", nl: "Academie & jeugd", engine: "youth" },
  { key: "market", label: "Transfermarked & scouting", en: "Transfer market & scouting", es: "Mercado de fichajes y ojeo", fr: "Transferts et recrutement", nl: "Transfermarkt & scouting", engine: "market" },
  { key: "club", label: "Klub & økonomi", en: "Club & finances", es: "Club y finanzas", fr: "Club et finances", nl: "Club & financiën", engine: "club" },
  { key: "board_sponsors", label: "Bestyrelse & sponsorer", en: "Board & sponsors", es: "Directiva y patrocinadores", fr: "Direction et sponsors", nl: "Bestuur & sponsors", engine: "club" },
  { key: "staff", label: "Stab & assistent", en: "Staff & assistant", es: "Personal y asistente", fr: "Staff et assistant", nl: "Staf & assistent", engine: "club" },
  { key: "rider_profile", label: "Rytterprofil & historik", en: "Rider profile & history", es: "Perfil e historial del ciclista", fr: "Profil et historique du coureur", nl: "Rennersprofiel & historiek", engine: "club" },
  { key: "calendar", label: "Kalender, ranglister & sæson", en: "Calendar, rankings & season", es: "Calendario, clasificaciones y temporada", fr: "Calendrier, classements et saison", nl: "Kalender, ranglijsten & seizoen", engine: "club" },
  { key: "social", label: "Fællesskab", en: "Community", es: "Comunidad", fr: "Communauté", nl: "Community", engine: "club" },
  { key: "app", label: "App, mobil & hjælp", en: "App, mobile & help", es: "App, móvil y ayuda", fr: "App, mobile et aide", nl: "App, mobiel & hulp", engine: "club" },
  { key: "growth", label: "Vækst & markedsføring", en: "Growth & marketing", es: "Crecimiento y marketing", fr: "Croissance et marketing", nl: "Groei & marketing", engine: "club", internal: true },
];

export type RoadmapLanguage = "da" | "en" | "es" | "fr" | "nl";

/** i18n-sprogkoden (fx "fr-FR") som et af roadmappets fem sprog; ukendt = engelsk. */
export function roadmapLanguage(language: string | undefined): RoadmapLanguage {
  const prefix = (language ?? "").slice(0, 2).toLowerCase();
  return prefix === "da" || prefix === "es" || prefix === "fr" || prefix === "nl" ? prefix : "en";
}
