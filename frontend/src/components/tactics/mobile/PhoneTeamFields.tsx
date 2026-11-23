// #8386 · Holdets valg på telefonen (ejer 17/11): "Today's plan" og "Chase the break?" er ét felt
// hver, der viser det valgte og åbner et ark fra bunden med valgene og en forklaring til hvert.
// Valgene, reglerne og handlingerne er værtens egne (samme som computerens kort og knapper).
// Plus den tynde bjælke, der siger, når en anden etape har ugemte ændringer (dirigentens
// forslag 3, valgt 17/11): den blokerer intet.
import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon as ChevronRightIconJs, InfoIcon as InfoIconJs } from "../../ui/index.js";
import PhoneSheet from "./PhoneSheet.tsx";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" };
const ChevronRightIcon = ChevronRightIconJs as unknown as (props: IconProps) => ReactNode;
const InfoIcon = InfoIconJs as unknown as (props: IconProps) => ReactNode;
type TFn = (key: string, opts?: Record<string, unknown>) => string;

export interface PhoneChoice {
  label: string;
  question: string;
  value: string;
  options: Array<{ value: string; label: string; note: string }>;
  disabled: boolean;
  onPick: (value: string) => void;
}

function Field({ label, value, onOpen, testId }: { label: string; value: string; onOpen: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-haspopup="dialog"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 py-2 text-left hover:bg-cz-subtle"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xs font-medium uppercase tracking-wider text-cz-3">{label}</span>
        <span className="truncate text-sm font-semibold text-cz-1">{value}</span>
      </span>
      <ChevronRightIcon size={14} aria-hidden="true" className="shrink-0 text-cz-3" />
    </button>
  );
}

/** "Today's plan": feltet viser den valgte plan; arket viser værtens egne kort med hver sin forklaring. */
export function PhoneTeamPlanField({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  const [open, setOpen] = useState(false);
  // Et valgt kort lukker arket (kortet selv lægger planen i kladden, som på computeren).
  const closeOnPick = (e: MouseEvent) => {
    const card = (e.target as HTMLElement).closest?.('button[data-testid^="team-plan-"]');
    if (card && !(card as HTMLButtonElement).disabled && card.getAttribute("aria-pressed") !== "true") setOpen(false);
  };
  return (
    <>
      <Field label={title} value={value} onOpen={() => setOpen(true)} testId="tactics-phone-plan-field" />
      {open && (
        <PhoneSheet label={title} heading={<h2 className="m-0 text-[15px] font-semibold text-cz-1">{title}</h2>} onClose={() => setOpen(false)} closeLabel={t("phone.close")} testId="tactics-phone-plan-sheet">
          {/* Kortene viser kun det valgtes forklaring på en smal flade; i arket står alle. */}
          <div onClick={closeOnPick} className="[&_.hidden]:block">{children}</div>
        </PhoneSheet>
      )}
    </>
  );
}

/** "Chase the break?": feltet viser valget; arket har de tre valg med hver sin forklaring. */
export function PhoneChoiceField({ choice }: { choice: PhoneChoice }) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  const [open, setOpen] = useState(false);
  const current = choice.options.find((o) => o.value === choice.value);
  return (
    <>
      <Field label={choice.question} value={current?.label ?? "—"} onOpen={() => setOpen(true)} testId="tactics-phone-chase-field" />
      {open && (
        <PhoneSheet
          label={choice.question}
          heading={<h2 className="m-0 text-[15px] font-semibold text-cz-1">{choice.question}</h2>}
          onClose={() => setOpen(false)}
          closeLabel={t("phone.close")}
          testId="tactics-phone-chase-sheet"
        >
          <div role="radiogroup" aria-label={choice.question} className="flex flex-col gap-2">
            {choice.options.map((o) => {
              const on = o.value === choice.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={choice.disabled}
                  onClick={() => { if (!on) choice.onPick(o.value); setOpen(false); }}
                  className={`flex min-h-11 flex-col items-start gap-1 rounded-cz border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? "border-cz-accent/40 bg-cz-accent/10" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
                  }`}
                >
                  <span className={`text-sm font-semibold leading-snug ${on ? "text-cz-accent-t" : "text-cz-1"}`}>{o.label}</span>
                  <span className="text-xs leading-snug text-cz-2">{o.note}</span>
                </button>
              );
            })}
          </div>
        </PhoneSheet>
      )}
    </>
  );
}

/** "Stage 4 has changes you have not saved." Tynd, under etapestriben og fanerne, blokerer intet. */
export function UnsavedStagesBar({ stages }: { stages: readonly number[] }) {
  const { t } = useTranslation("tactics") as unknown as { t: TFn };
  if (!stages.length) return null;
  return (
    <p role="status" data-testid="tactics-phone-unsaved-stages" className="m-0 flex items-start gap-2 rounded-cz border border-cz-warning/40 bg-cz-warning/10 px-3 py-2 text-xs text-cz-1">
      <InfoIcon size={14} aria-hidden="true" className="mt-px shrink-0 text-cz-warning" />
      <span>
        <b className="font-semibold">{t("phone.unsaved", { count: stages.length, stages: stages.join(", ") })}</b>{" "}
        <span className="text-cz-2">{t("phone.unsavedNote")}</span>
      </span>
    </p>
  );
}
