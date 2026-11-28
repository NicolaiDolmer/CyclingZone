// #7884/#8828 · "Angrib på" (wireframe docs/design/tactics-7884/angrib-paa-wireframe.html): stederne fra
// ruten som en radioliste med fakta og prisordet, reglen i ord og ét valg. Computer: et panel ved
// siden af tabellen. Telefon: et ark fra bunden (PhoneSheet). Teksterne er allerede oversat af værten.
import { useState, type ReactNode } from "react";
import PhoneSheet from "./mobile/PhoneSheet.tsx";
import { Button } from "../race/stagePageV2/ui.ts";

export interface LongAttackOption7884 {
  key: string;
  title: string;
  facts: string;
  /** Hvorfor stedet ikke kan vælges i denne plan, eller null. */
  blocked: string | null;
}

export interface LongAttackPicker7884Props {
  title: string;
  subtitle: string;
  options: LongAttackOption7884[];
  /** Det valgte sted i planen nu (null = intet angreb). */
  value: string | null;
  noneLabel: string;
  price: string;
  rule: string;
  chooseLabel: (title: string) => string;
  removeLabel: string;
  closeLabel: string;
  disabled: boolean;
  onPick: (key: string | null) => void;
  onClose: () => void;
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function PlaceList({ props, pending, setPending }: { props: LongAttackPicker7884Props; pending: string | null; setPending: (key: string | null) => void }) {
  const row = (key: string | null, title: string, facts: string | null, blocked: string | null, price: boolean) => {
    const on = pending === key;
    return (
      <label
        key={key ?? "none"}
        className={`mt-2 grid min-h-11 cursor-pointer grid-cols-[1.375rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-cz border bg-cz-card px-2.5 py-2.5 text-sm ${
          on ? "border-cz-accent-t border-l-[3px] border-l-cz-accent" : "border-cz-border"
        } ${blocked ? "cursor-not-allowed opacity-50" : ""}`}
        title={blocked ?? undefined}
      >
        <input
          type="radio"
          name="long-attack-7884"
          className="mt-0.5 h-[1.125rem] w-[1.125rem] accent-[rgb(var(--accent-t))]"
          checked={on}
          disabled={props.disabled || blocked !== null}
          onChange={() => setPending(key)}
        />
        <span className="min-w-0">
          <b className="font-semibold text-cz-1">{title}</b>
          {facts && <span className="block text-xs text-cz-2">{facts}</span>}
        </span>
        {price ? <span className="whitespace-nowrap text-xs font-semibold text-cz-danger">{props.price}</span> : <span />}
      </label>
    );
  };
  return (
    <div role="radiogroup" aria-label={props.title}>
      {props.options.map((o) => row(o.key, o.title, o.facts, o.blocked, true))}
      {props.value !== null && row(null, props.noneLabel, null, null, false)}
    </div>
  );
}

function useChoice(props: LongAttackPicker7884Props) {
  const [pending, setPending] = useState<string | null>(props.value);
  const picked = props.options.find((o) => o.key === pending) ?? null;
  const label = pending === null ? (props.value === null ? null : props.removeLabel) : picked ? props.chooseLabel(picked.title) : null;
  const confirm = () => { props.onPick(pending); props.onClose(); };
  return { pending, setPending, label, confirm };
}

function Rule({ text }: { text: string }) {
  return <p className="m-0 mt-3 flex gap-2 rounded-cz border border-cz-border px-3 py-2.5 text-sm text-cz-2"><InfoIcon /><span>{text}</span></p>;
}

/** Computer: panelet ved siden af tabellen (wireframets højre kolonne). */
export function LongAttackPanel7884(props: LongAttackPicker7884Props): ReactNode {
  const { pending, setPending, label, confirm } = useChoice(props);
  return (
    <section aria-label={props.title} data-testid="long-attack-panel" className="rounded-cz border border-cz-border bg-cz-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-base font-semibold text-cz-1">{props.title}</h3>
          <p className="m-0 text-sm text-cz-3">{props.subtitle}</p>
        </div>
        <button type="button" onClick={props.onClose} className="inline-flex h-8 items-center rounded-cz border border-cz-border bg-cz-card px-2.5 text-xs font-medium text-cz-2 hover:bg-cz-subtle">
          {props.closeLabel}
        </button>
      </div>
      <PlaceList props={props} pending={pending} setPending={setPending} />
      <Rule text={props.rule} />
      {/* TASTE: én gold primær-knap pr. view; fodens "Gem" er den. Valget her er sekundært. */}
      <button
        type="button"
        disabled={props.disabled || label === null || pending === props.value}
        onClick={confirm}
        className="mt-3.5 block min-h-11 w-full rounded-cz border border-cz-accent-t bg-cz-card px-3 text-sm font-semibold text-cz-accent-t hover:bg-cz-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label ?? props.chooseLabel("")}
      </button>
    </section>
  );
}

/** Telefon: arket fra bunden (wireframets "Vælg <sted>"). */
export function LongAttackSheet7884(props: LongAttackPicker7884Props): ReactNode {
  const { pending, setPending, label, confirm } = useChoice(props);
  return (
    <PhoneSheet
      label={props.title}
      testId="long-attack-sheet"
      heading={<><p className="m-0 text-base font-semibold text-cz-1">{props.title}</p><p className="m-0 text-sm text-cz-3">{props.subtitle}</p></>}
      onClose={props.onClose}
      closeLabel={props.closeLabel}
      footer={(
        <Button variant="primary" size="md" disabled={props.disabled || label === null || pending === props.value} onClick={confirm} className="min-h-11 w-full">
          {label ?? props.chooseLabel("")}
        </Button>
      )}
    >
      <PlaceList props={props} pending={pending} setPending={setPending} />
      <Rule text={props.rule} />
    </PhoneSheet>
  );
}
