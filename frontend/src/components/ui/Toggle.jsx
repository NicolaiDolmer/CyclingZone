// #6768: slukket spor + tommel paa kontrol-tokens (>= 3:1 mod fladen, WCAG 1.4.11)
// og en 1px border-strong, saa kontakten aldrig forsvinder i moerkt tema.
// Taendt: accent-spor med on-accent-tommel; kanten forbliver border-strong, saa
// sporet ogsaa i lyst tema har >= 3:1 mod fladen (accent alene er ca. 1,5:1).
export default function Toggle({ label, id, checked, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-cz-1">
      <span className={`relative inline-block h-5 w-9 shrink-0 ${className}`}>
        <input id={id} type="checkbox" role="switch" checked={checked} className="peer sr-only" {...rest} />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-cz-pill border border-cz-border-strong bg-cz-toggle-off transition-colors duration-150 peer-checked:bg-cz-accent peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cz-accent-t"
        />
        <span
          aria-hidden="true"
          className="absolute left-0.5 top-0.5 h-4 w-4 rounded-cz-pill bg-cz-toggle-thumb transition-transform duration-150 peer-checked:translate-x-4 peer-checked:bg-cz-on-accent"
        />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
