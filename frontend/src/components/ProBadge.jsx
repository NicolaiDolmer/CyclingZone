import { StarIcon } from "./ui/icons/index.jsx";

// Lille statusmærke. Vises kun for Pro/Founder. Ingen glow/gradient — hairline +
// accent-tekst, jf. design-smag (editorial, høj detalje, 0 AI-slop).
export default function ProBadge({ isFounder }) {
  return (
    <span className="inline-flex items-center gap-1 border border-cz-accent rounded-cz px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cz-accent-t">
      <StarIcon size={11} className="text-cz-accent-t" aria-hidden="true" />
      {isFounder ? "Founder" : "Pro"}
    </span>
  );
}
