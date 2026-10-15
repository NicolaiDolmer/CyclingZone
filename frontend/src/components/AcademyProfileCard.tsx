// AcademyProfileCard — #6666 (D-039, ejer-beslutninger 15/10 punkt 4-5).
//
// Akademiets ønskede profil: nationalitet/region og ryttertype. Felterne låses op
// af akademi-facilitetens niveau (model 1): 0 ingen profil · 1 nationalitet/region
// · 2 + type · 3 stærkere · 4 + ét ekstra valg · 5 stærkest. Backend afgør hvad
// niveauet tillader (`profile.slots`); kortet viser kun det og sender valget.
// En ændring virker først efter `options.delayDays` dage, så kortet viser både den
// aktive profil og en evt. ventende.
//
// Ingen guld-knap: sidens eneste primære handling er "Hent ugens kandidater"
// (TASTE: ét guld pr. view). Gem er secondary.
import { useMemo, useState } from "react";
import type { ChangeEvent, ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Card, Button, Select, Field as FieldJs, SectionHeader as SectionHeaderJs } from "./ui/index.js";

// Kit-primitiverne er .jsx uden egne typer; kontrakten skrives ned her (samme
// greb som race/stagePageV2/ui.ts).
const SectionHeader = SectionHeaderJs as unknown as ComponentType<{ title: ReactNode; meta?: ReactNode }>;
const Field = FieldJs as unknown as ComponentType<{
  label: ReactNode; htmlFor: string; helper?: ReactNode; children: ReactNode;
}>;
type SelectChange = ChangeEvent<HTMLSelectElement>;
import { buttonClass } from "./ui/buttonStyles.js";
import { getCountryName } from "../lib/countryUtils";
import { formatDate } from "../lib/intl.js";

const REGION = "region:";
const TYPE = "type:";

export interface ProfileValue {
  origins: string[];
  types: string[];
  effectiveFrom?: string;
}

export interface AcademyProfile {
  tier: number;
  candidatesPerWeek: number;
  slots: { origins: number; types: number; extra: number };
  active: ProfileValue | null;
  pending: ProfileValue | null;
  options: { nations: string[]; regions: string[]; types: string[]; delayDays: number };
}

interface Choice { origin: string; type: string; extra: string }
type SaveResult = { ok: boolean; result?: { effectiveFrom?: string }; error?: string };

function initialChoice(profile: ProfileValue | null | undefined): Choice {
  const origins = profile?.origins ?? [];
  const types = profile?.types ?? [];
  let extra = "";
  if (origins.length > 1) extra = origins[1] ?? "";
  else if (types.length > 1) extra = `${TYPE}${types[1]}`;
  return { origin: origins[0] ?? "", type: types[0] ?? "", extra };
}

export function choiceToProfile({ origin, type, extra }: Choice): ProfileValue {
  const origins = [origin].filter(Boolean);
  const types = [type].filter(Boolean);
  if (extra?.startsWith(TYPE)) types.push(extra.slice(TYPE.length));
  else if (extra) origins.push(extra);
  return { origins: [...new Set(origins)], types: [...new Set(types)] };
}

export default function AcademyProfileCard({ profile, onSave }: {
  profile: AcademyProfile | null;
  onSave: (profile: ProfileValue) => Promise<SaveResult>;
}) {
  const { t, i18n } = useTranslation("academy");
  const { t: tTypes } = useTranslation("riderTypes");
  const slots = profile?.slots ?? { origins: 0, types: 0, extra: 0 };
  const options = profile?.options ?? { nations: [], regions: [], types: [], delayDays: 14 };
  const locked = (profile?.tier ?? 0) === 0 || slots.origins === 0;
  const [choice, setChoice] = useState(() => initialChoice(profile?.pending ?? profile?.active));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const originLabel = (o: string): string => (o.startsWith(REGION)
    ? t(`profile.regions.${o.slice(REGION.length)}`)
    : getCountryName(o, i18n.language));
  const describe = (p: ProfileValue | null | undefined): string => [
    ...(p?.origins ?? []).map(originLabel),
    ...(p?.types ?? []).map((k: string) => tTypes(`types.${k}`)),
  ].join(" · ");

  const nations = useMemo(
    () => [...options.nations].sort((a, b) => getCountryName(a, i18n.language).localeCompare(getCountryName(b, i18n.language))),
    [options.nations, i18n.language],
  );
  const originOptions = (
    <>
      <option value="">{t("profile.none")}</option>
      <optgroup label={t("profile.groupRegions")}>
        {options.regions.map((r) => <option key={r} value={`${REGION}${r}`}>{t(`profile.regions.${r}`)}</option>)}
      </optgroup>
      <optgroup label={t("profile.groupNations")}>
        {nations.map((n) => <option key={n} value={n}>{getCountryName(n, i18n.language)}</option>)}
      </optgroup>
    </>
  );
  const typeOptions = (prefix = "") => options.types.map((k) => (
    <option key={k} value={`${prefix}${k}`}>{tTypes(`types.${k}`)}</option>
  ));

  const current = choiceToProfile(choice);
  const saved = profile?.pending ?? profile?.active ?? { origins: [], types: [] };
  const dirty = JSON.stringify(current) !== JSON.stringify({ origins: saved.origins ?? [], types: saved.types ?? [] });

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    const res = await onSave(current);
    setBusy(false);
    setMessage(res.ok
      ? { kind: "ok", text: t("profile.saved", { date: formatDate(res.result?.effectiveFrom) }) }
      : { kind: "error", text: t("profile.errorSave") });
  }

  return (
    <section data-testid="academy-profile">
      <SectionHeader
        title={t("profile.heading")}
        meta={t("profile.meta", { tier: profile?.tier ?? 0, count: profile?.candidatesPerWeek ?? 0 })}
      />
      <Card className="p-4 flex flex-col gap-4">
        {locked ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-cz-2">{t("profile.locked")}</p>
            <Link to="/klub" className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>
              {t("profile.lockedAction")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-xs text-cz-2">{t("profile.intro")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t("profile.origin")} htmlFor="academy-profile-origin">
                <Select id="academy-profile-origin" size="sm" value={choice.origin}
                  onChange={(e: SelectChange) => setChoice((c) => ({ ...c, origin: e.target.value }))}>
                  {originOptions}
                </Select>
              </Field>
              <Field label={t("profile.type")} htmlFor="academy-profile-type"
                helper={slots.types === 0 ? t("profile.typeLocked") : undefined}>
                <Select id="academy-profile-type" size="sm" value={choice.type} disabled={slots.types === 0}
                  onChange={(e: SelectChange) => setChoice((c) => ({ ...c, type: e.target.value }))}>
                  <option value="">{t("profile.none")}</option>
                  {typeOptions()}
                </Select>
              </Field>
              <Field label={t("profile.extra")} htmlFor="academy-profile-extra"
                helper={slots.extra === 0 ? t("profile.extraLocked") : undefined}>
                <Select id="academy-profile-extra" size="sm" value={choice.extra} disabled={slots.extra === 0}
                  onChange={(e: SelectChange) => setChoice((c) => ({ ...c, extra: e.target.value }))}>
                  <option value="">{t("profile.none")}</option>
                  <optgroup label={t("profile.groupRegions")}>
                    {options.regions.map((r) => <option key={r} value={`${REGION}${r}`}>{t(`profile.regions.${r}`)}</option>)}
                  </optgroup>
                  <optgroup label={t("profile.groupNations")}>
                    {nations.map((n) => <option key={n} value={n}>{getCountryName(n, i18n.language)}</option>)}
                  </optgroup>
                  <optgroup label={t("profile.groupTypes")}>{typeOptions(TYPE)}</optgroup>
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-3 border-t border-cz-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-cz-2 space-y-0.5">
                <p>{profile?.active ? t("profile.active", { profile: describe(profile.active) || t("profile.none") }) : t("profile.activeNone")}</p>
                {profile?.pending && (
                  <p className="text-cz-3">
                    {t("profile.pending", { date: formatDate(profile.pending.effectiveFrom), profile: describe(profile.pending) || t("profile.none") })}
                  </p>
                )}
                {!profile?.pending && <p className="text-cz-3">{t("profile.delayNote", { days: options.delayDays })}</p>}
              </div>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={handleSave} disabled={busy || !dirty} loading={busy}>
                {t("profile.save")}
              </Button>
            </div>
            {message && (
              <p className={`text-xs ${message.kind === "error" ? "text-cz-danger" : "text-cz-2"}`} role="status">{message.text}</p>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
