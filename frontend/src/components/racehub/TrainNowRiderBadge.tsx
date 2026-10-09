// #6383: "Trained today"-mærket på en rytter der er låst af Train now. Samme udtryk som
// udtagelsespanelets mærke (#6139); label kommer fra kalderen (selection.trainNowLock.rider).
import { LockIcon } from "../ui";

export default function TrainNowRiderBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-3xs px-2 py-0.5 rounded-full bg-cz-subtle text-cz-3 border border-cz-border whitespace-nowrap">
      <LockIcon size={10} aria-hidden="true" />
      {label}
    </span>
  );
}
