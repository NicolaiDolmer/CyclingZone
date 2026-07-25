// #2849 bølge 6 — `borderClass` findes fordi en border-farve IKKE kan overrides
// via `className`: Tailwind emitterer `.border-cz-border` EFTER `.border-cz-accent-t`
// og `.border-cz-accent/{30,40}` i bundtet, så Cards egen hairline vandt cascaden og
// kalderens guldkant forsvandt tavst. (Målt i dist/assets/index-*.css: border-cz-border
// @22745 vs border-cz-accent/40 @22568.) Danger/success ligger EFTER og virkede — derfor
// blev det aldrig opdaget. Send farven som prop i stedet for i className.
export default function Card({
  interactive = false,
  borderClass = "border-cz-border",
  className = "",
  children,
  ...rest
}) {
  const base = `rounded-cz border ${borderClass} bg-cz-card`;
  const hover = interactive ? "transition-colors duration-150 hover:border-cz-3" : "";
  return (
    <div className={`${base} ${hover} ${className}`} {...rest}>
      {children}
    </div>
  );
}
