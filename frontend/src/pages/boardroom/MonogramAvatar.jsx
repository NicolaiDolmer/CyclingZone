// #4557 (bundle-budget-fix) · Delt monogram-avatar-markup. Brugt 3 steder med
// forskellig størrelse/tone (MandateCard's 28px neutrale ejer-avatar,
// BoardCard's 44px navy medlems-avatar, MemberPanel's 72px navy portræt-slot)
// — én kilde i stedet for 3x duplikeret div/span-markup (perf-gate: total
// gzip-bundle taeller ALLE chunks, saa duplikeret JSX koster reelle bytes).
export default function MonogramAvatar({ sizeClass, initials, initialsClass, navy = false, column = false, className = "", children }) {
  const toneClass = navy ? "bg-cz-sidebar text-cz-sidebar-1" : "border border-cz-border bg-cz-subtle text-cz-2";
  return (
    <div className={`relative flex flex-shrink-0 items-center justify-center rounded-cz ${toneClass} ${column ? "flex-col" : ""} ${sizeClass} ${className}`}>
      <span className={`${navy ? "font-display leading-none" : "font-semibold"} ${initialsClass}`}>{initials}</span>
      {children}
    </div>
  );
}
