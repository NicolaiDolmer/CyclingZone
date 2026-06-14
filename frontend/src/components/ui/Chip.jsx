import { chipClass } from "./chipStyles.js";

// Sparsom hero-pille. `icon` er valgfri (et ikon-element); placeres til venstre.
export default function Chip({ icon, className = "", children, ...rest }) {
  return (
    <span className={chipClass({ className })} {...rest}>
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
