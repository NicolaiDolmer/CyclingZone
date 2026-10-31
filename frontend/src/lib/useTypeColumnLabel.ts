// #5435/#6853: overskriften på type-badge-kolonnen i rytter-tabellerne. Badget
// er anlægget, og kolonnen hedder "Natural role / Naturlig rolle" — ét sted, så
// tabellerne ikke kan kalde den hver sin ting.
import { useTranslation } from "react-i18next";

export function useTypeColumnLabel(): string {
  const { t } = useTranslation("riderTypes");
  return t("natural.roleLabel");
}
