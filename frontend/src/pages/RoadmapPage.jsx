// Player-facing roadmap (#1169) — retning og ambition for de fire produkt-
// motorer (løb, træning, ungdom, marked), founder-led tone, ingen datoer.
// Indhold ejes af locales/{en,da}/roadmap.json; strategi-følsom copy reviewes
// af ejer før ændringer (jf. docs/TONE_OF_VOICE.md).

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const ENGINES = [
  { key: "races", icon: "🏁" },
  { key: "training", icon: "📈" },
  { key: "youth", icon: "🌱" },
  { key: "market", icon: "⚡" },
];

export default function RoadmapPage() {
  const { t } = useTranslation("roadmap");

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl px-5 py-4 mb-4">
        <p className="text-cz-2 text-sm leading-relaxed">{t("intro.p1")}</p>
        <p className="text-cz-1 text-sm leading-relaxed font-semibold mt-3">{t("intro.fairness")}</p>
      </div>

      <div className="flex flex-col gap-3">
        {ENGINES.map(({ key, icon }) => (
          <div key={key} className="bg-cz-card border border-cz-border rounded-xl px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span aria-hidden="true">{icon}</span>
              <h2 className="text-cz-1 font-bold text-sm">{t(`engines.${key}.title`)}</h2>
            </div>

            <div className="mb-3">
              <div className="text-cz-3 text-[10px] font-semibold uppercase tracking-wider mb-1">
                {t("labels.today")}
              </div>
              <p className="text-cz-2 text-sm leading-relaxed">{t(`engines.${key}.today`)}</p>
            </div>

            <div>
              <div className="text-cz-accent-t text-[10px] font-semibold uppercase tracking-wider mb-1">
                {t("labels.next")}
              </div>
              <ul className="flex flex-col gap-1.5">
                {t(`engines.${key}.next`, { returnObjects: true }).map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full flex-shrink-0 mt-1.5 bg-cz-accent" />
                    <span className="text-cz-2 text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl px-5 py-4 mt-4">
        <h2 className="text-cz-1 font-bold text-sm mb-2">{t("outro.title")}</h2>
        <p className="text-cz-2 text-sm leading-relaxed">{t("outro.p1")}</p>
        <Link
          to="/patch-notes"
          className="inline-block mt-3 text-cz-accent-t text-sm font-semibold hover:underline"
        >
          {t("outro.patchNotesCta")} →
        </Link>
      </div>
    </div>
  );
}
