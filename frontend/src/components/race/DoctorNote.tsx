// #6984 M4 + M8: holdlægens ord om én rytter på holdudtagelsen. Kun ord, aldrig tal;
// backend sender nøgler (doctorReport.js) og kun når condition_model_v2 er on.
import { useTranslation } from "react-i18next";

export type DoctorEntry = {
  assessment: "fresh" | "ready" | "tired" | "rest" | "injured" | null;
  season?: "ready" | "ready_but_spent_later" | "already_heavy" | "rest_first" | "injured";
};

const TONE: Record<string, string> = {
  fresh: "text-cz-success",
  ready: "text-cz-2",
  tired: "text-cz-accent-t",
  rest: "text-cz-danger",
  injured: "text-cz-danger",
};

export default function DoctorNote({ entry, showSeason = true }: { entry?: DoctorEntry | null; showSeason?: boolean }) {
  const { t } = useTranslation("races");
  if (!entry?.assessment) return null;
  return (
    <span className="inline-flex flex-col items-end text-right leading-tight" data-testid="doctor-note">
      <span className={`text-xs ${TONE[entry.assessment] ?? "text-cz-2"}`}>{t(`selection.doctor.assessment.${entry.assessment}`)}</span>
      {showSeason && entry.season && entry.season !== "injured" && (
        <span className="text-2xs text-cz-3 max-w-[220px]">{t(`selection.doctor.season.${entry.season}`)}</span>
      )}
    </span>
  );
}
