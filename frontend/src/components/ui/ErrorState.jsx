import { AlertTriangleIcon } from "./icons/index.jsx";

// #2849 bølge 0 — kanonisk error-state (states-sheet i docs/design/PAGE_TEMPLATES.md):
// samme anatomi som EmptyState; danger KUN i ikonet — ingen røde flader/paneler.
// Beskrivelsen siger hvad der er sikkert ("Nothing was lost — your bids are safe.");
// retry er ALTID secondary sm, aldrig gold.
// #5325 — role="alert" (ikke aria-live="assertive" på en fast beholder):
// ErrorState monteres altid conditionally (`{error && <ErrorState .../>}` /
// `if (error) return <ErrorState .../>`), aldrig som en beholder der allerede
// findes i DOM'en før fejlen opstår. Et element med role="alert" der FØRST
// indsættes i DOM'en når fejlen findes, bliver annonceret af skærmlæsere uden
// videre — der er intet "eksisterende element hvis indhold ændres" at holde
// styr på her, så aria-live er unødvendigt.
export default function ErrorState({
  title = "Something went wrong",
  description,
  action = null,
  className = "",
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 rounded-cz border border-dashed border-cz-border bg-cz-card px-6 py-8 text-center ${className}`}
    >
      <AlertTriangleIcon size={26} className="text-cz-danger" />
      <div>
        <p className="text-[15px] font-semibold text-cz-1">{title}</p>
        {description && <p className="mt-1 max-w-sm text-[13px] text-cz-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}
