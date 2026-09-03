// Mini-oversætter til de statisk importerede landing-ordbøger (1:1-kopier af
// frontend/public/locales/{en,da}/landing.json). Dot-path-opslag som i18next's
// t(), så den portede LandingPage kan beholde sine t("hero.title")-kald.

export type Dict = Record<string, unknown>;

export type TFunc = {
  (key: string): string;
  raw<T = unknown>(key: string): T;
};

function lookup(dict: Dict, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in (node as Dict)) {
      return (node as Dict)[part];
    }
    return undefined;
  }, dict);
}

export function makeT(dict: Dict): TFunc {
  const t = ((key: string) => {
    const value = lookup(dict, key);
    return typeof value === "string" ? value : key;
  }) as TFunc;
  t.raw = <T,>(key: string) => lookup(dict, key) as T;
  return t;
}
