// #2849 bølge 0 — DEN kanoniske sidehoved-recipe (docs/design/PAGE_TEMPLATES.md).
// Erstatter de 9 håndrullede header-varianter fra design-audit'en.
// Action-cluster-kontrakt: maks én Select (sm) + én primær Button (sm) — intet andet.
// På mobil wrapper clusteret under titel-blokken (flex-wrap).
export default function PageHeader({ title, subtitle, actions = null, className = "", ...rest }) {
  return (
    <header
      className={`mb-6 flex flex-wrap items-center justify-between gap-4 ${className}`}
      {...rest}
    >
      <div className="min-w-0">
        <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-cz-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
