import { tierPips } from "../../lib/facilityDisplay";

// 5-trins tier-ladder. Fyldte pips = guld (brand-accent), tomme = subtle inset.
export default function TierLadder({ tier, max = 5 }) {
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`Tier ${tier} of ${max}`}>
      {tierPips(tier, max).map((filled, i) => (
        <span
          key={i}
          className={`inline-block h-[7px] w-5 rounded-[1px] border border-cz-accent/60 ${filled ? "bg-cz-accent" : "bg-cz-subtle"}`}
        />
      ))}
    </div>
  );
}
