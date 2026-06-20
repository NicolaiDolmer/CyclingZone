import { useState } from "react";
import { PATCHES } from "../data/patchNotes.js";

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState(PATCHES[0]?.version ?? null);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Patch Notes</h1>
        <p className="text-cz-3 text-sm">Opdateringshistorik for Cycling Zone Manager</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATCHES.map((patch) => {
          const isOpen = expanded === patch.version;
          return (
            <div key={patch.version}
              className={`bg-cz-card border rounded-xl overflow-hidden transition-all
                ${isOpen ? "border-cz-accent/30" : "border-cz-border"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : patch.version)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-cz-1 font-bold text-sm">v{patch.version}</span>
                  <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">
                    {patch.label}
                  </span>
                  <span className="text-cz-3 text-xs">{patch.date}</span>
                </div>
                <span className={`text-cz-3 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-cz-border pt-4 space-y-4">
                  {patch.changes.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                          ${section.category === "Nyt" ? "bg-green-400" :
                            section.category === "Forbedringer" ? "bg-blue-400" :
                            section.category === "Fejlrettelser" ? "bg-red-400" :
                            "bg-cz-accent"}`} />
                        <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">
                          {section.category}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-1.5 ms-3.5">
                        {section.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <div className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5
                              ${section.category === "Nyt" ? "bg-green-400" :
                                section.category === "Forbedringer" ? "bg-blue-400" :
                                section.category === "Fejlrettelser" ? "bg-red-400" :
                                "bg-cz-accent"}`} />
                            <span className="text-cz-2 text-sm leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
