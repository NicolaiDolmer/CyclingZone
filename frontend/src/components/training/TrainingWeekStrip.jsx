// TrainingWeekStrip — rytterens næste 7 dage som én strimmel (#4613, retning B).
//
// Ren visning. Dagene kommer fra lib/trainingWeekStrip.js (unit-testet), som
// kun lagdeler data siden allerede har. Intet nyt kald, ingen opdigtede
// løbsdage fremad (kun dag 0 kan bære en løbsmarkering).
//
// Anatomi (PAGE_TEMPLATES: hairlines, ingen skygger, ét guld): 7 lodrette
// blokke, belastning = guld-tæthed, hviledag = stiplet hairline, løbsdag =
// fyldt --text-1, i dag = outline. Ingen radius (blokkene er 9px brede, hvor
// systemets ene 5px-radius ville gøre dem til aflange dråber), ingen tekst
// under 10px — hele strimlen er ÉT `role="img"` med en aria-label i klar
// tekst, så skærmlæseren får ugen som ord i stedet for 7 tomme kasser.

import { useTranslation } from "react-i18next";

// Belastning → guld-tæthed. Guld er sidens ene accent, og de fire trin er
// præcis de fire TRAINING_INTENSITIES der ikke er hvile.
const INTENSITY_TONE = Object.freeze({
  rest: "border border-dashed border-cz-border",
  recovery: "bg-cz-subtle",
  easy: "bg-cz-accent/25",
  normal: "bg-cz-accent/45",
  hard: "bg-cz-accent/70",
});

export default function TrainingWeekStrip({ days }) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  if (!days?.length) return null;

  const label = days
    .map((day) => {
      const what = day.isRace
        ? t("raceDayBadge")
        : tRider(`training.intensity_${day.intensity}`);
      return `${t(`weekday_${day.weekday}`)} ${what}`;
    })
    .join(", ");

  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-end gap-[2px]">
      {days.map((day) => (
        <span
          key={day.offset}
          aria-hidden="true"
          className={`block h-4 w-[9px] ${
            day.isRace ? "bg-cz-1" : INTENSITY_TONE[day.intensity] ?? INTENSITY_TONE.normal
          } ${day.isToday ? "outline outline-1 outline-offset-1 outline-cz-1" : ""}`}
        />
      ))}
    </span>
  );
}
