// #8049 · Byggeklodserne til den nye patch notes-side: mærket, ulæst-prikken, en linje,
// et område i "Denne uge" (variant A) og et område pr. række (variant B, når en ældre
// uge eller en arkivmåned åbnes). Ejerens valg 16/11; TASTE: firkantede mærker med 5px
// radius (ikke piller), hairlines, tabulære tal, stroke-ikoner.
import { tagOf, isNewSince, groupByArea, countTags } from "../../lib/patchNotes.js";
import { ChevronRightIcon, ChevronDownIcon } from "../ui";

// Én anatomi for alle fem mærker; kun tre farvesignaler (grøn, blå, gul), ingen guld.
const TAG_TONE = {
  on: "border-cz-success/45 text-cz-success",
  new: "border-cz-info/45 text-cz-info",
  beta: "border-cz-warning/50 text-cz-warning",
  improved: "border-cz-border-strong/50 text-cz-2",
  fixed: "border-cz-border text-cz-3",
};

// Mobil: trykflader mindst 44 x 44 (P16), samme medie-betingelse som knap-kittet.
export const TOUCH = "[@media(max-width:640px),(pointer:coarse)]:min-h-11";

export function PatchTag({ tag, t, className = "" }) {
  return (
    <span
      data-tag={tag}
      className={`inline-flex h-5 items-center justify-center whitespace-nowrap rounded-cz border px-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] ${TAG_TONE[tag] || TAG_TONE.improved} ${className}`}
    >
      {t(`v2.tag.${tag}`)}
    </span>
  );
}

export function NewDot({ t }) {
  return (
    <span className="inline-flex h-[7px] w-[7px] shrink-0 rounded-cz-pill bg-cz-accent" role="img" aria-label={t("v2.newDot")} />
  );
}

export function QuietButton({ children, className = "", chevron = "right", ...rest }) {
  const Icon = chevron === "down" ? ChevronDownIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-cz-accent-t hover:underline ${TOUCH} ${className}`}
      {...rest}
    >
      {children}
      {chevron && <Icon size={13} aria-hidden="true" />}
    </button>
  );
}

function FallbackNote({ item, t }) {
  if (!item.fb) return null;
  return <span className="ms-1 text-xs text-cz-3">({t(`fallbackLang.${item.fb}`)})</span>;
}

const LINE_GRID = "grid grid-cols-[132px_minmax(0,1fr)_12px] items-start gap-x-3 max-sm:grid-cols-[minmax(0,1fr)_12px] max-sm:gap-y-1";

/** Én ændring: mærke, titel, én linje tekst (tryk viser resten), prik hvis ny. */
export function PatchLine({ item, t, liveFlags, marker, open, onToggle, quietTitle = false }) {
  const hasBody = Boolean(item.b) && item.b !== item.ti;
  const isNew = isNewSince(item, marker);
  return (
    <li className={`${LINE_GRID} py-[7px]`}>
      <PatchTag tag={tagOf(item, liveFlags)} t={t} className="justify-self-start max-sm:col-span-2" />
      <button
        type="button"
        onClick={hasBody ? onToggle : undefined}
        aria-expanded={hasBody ? open : undefined}
        className={`min-w-0 text-left ${hasBody ? "" : "cursor-default"}`}
      >
        <span className={`block text-[13.5px] leading-snug text-cz-1 ${quietTitle ? "font-normal" : "font-medium"}`}>
          {item.ti || item.b}
          <FallbackNote item={item} t={t} />
        </span>
        {hasBody && (
          <span className={`mt-px block text-[12.5px] leading-[1.45] text-cz-2 ${open ? "whitespace-pre-line" : "line-clamp-1 max-sm:line-clamp-2"}`}>
            {item.b}
          </span>
        )}
      </button>
      <span className="pt-[6px] max-sm:col-start-2 max-sm:row-start-2">{isNew && <NewDot t={t} />}</span>
    </li>
  );
}

/** Ugens store nyhed: neutral flade, billede kun når noten har et (ejer 16/11, valg 4). */
export function PatchHero({ item, t, liveFlags, marker, areaLabel }) {
  return (
    <div className={`mb-5 rounded-cz bg-cz-subtle p-3.5 ${item.img ? "sm:grid sm:grid-cols-[208px_minmax(0,1fr)] sm:gap-4" : ""}`}>
      {item.img && (
        <img
          src={item.img}
          alt={t("v2.heroImageAlt", { title: item.ti })}
          width={640}
          height={310}
          loading="lazy"
          decoding="async"
          className="mb-3 aspect-[2/1] w-full rounded-cz border border-cz-border object-cover object-left-top sm:mb-0 sm:aspect-[16/9]"
        />
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PatchTag tag={tagOf(item, liveFlags)} t={t} />
          <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{areaLabel}</span>
          {isNewSince(item, marker) && <NewDot t={t} />}
        </div>
        <h3 className="mb-1 mt-1.5 text-base font-semibold leading-snug text-cz-1">
          {item.ti}
          <FallbackNote item={item} t={t} />
        </h3>
        {item.b && <p className="whitespace-pre-line text-[13px] leading-normal text-cz-2">{item.b}</p>}
      </div>
    </div>
  );
}

/**
 * Variant A ("Denne uge", ejerens valg): ét afsnit pr. område, højst 3 linjer,
 * "+N mere i X", og fejlrettelser foldet til én linje pr. område.
 */
export function AreaBlocksA({ items, t, liveFlags, marker, areaLabel, expanded, toggle, prefix, max = 3 }) {
  return groupByArea(items, liveFlags).map(([area, list], index) => {
    const main = list.filter((it) => tagOf(it, liveFlags) !== "fixed");
    const fixes = list.filter((it) => tagOf(it, liveFlags) === "fixed");
    const key = `${prefix}:${area}`;
    const showAll = expanded.has(key);
    const shown = showAll ? main : main.slice(0, max);
    const fixKey = `${key}:fixes`;
    const fixesOpen = expanded.has(fixKey);
    return (
      <section key={area} className={index === 0 ? "" : "mt-3 border-t border-cz-border pt-3"} aria-label={areaLabel(area)}>
        <h3 className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-cz-1">{areaLabel(area)}</span>
          <span className="font-data text-2xs tabular-nums tracking-[.08em] text-cz-3">{list.length}</span>
        </h3>
        {shown.length > 0 && (
          <ul>
            {shown.map((it) => (
              <PatchLine key={it.k} item={it} t={t} liveFlags={liveFlags} marker={marker}
                open={expanded.has(`line:${it.k}`)} onToggle={() => toggle(`line:${it.k}`)} />
            ))}
          </ul>
        )}
        {main.length > max && !showAll && (
          <QuietButton className="sm:ms-[144px]" chevron={null} onClick={() => toggle(key)}>
            {t("v2.moreIn", { count: main.length - max, area: areaLabel(area) })}
          </QuietButton>
        )}
        {fixes.length > 0 && (fixesOpen ? (
          <ul>
            {fixes.map((it) => (
              <PatchLine key={it.k} item={it} t={t} liveFlags={liveFlags} marker={marker}
                open={expanded.has(`line:${it.k}`)} onToggle={() => toggle(`line:${it.k}`)} />
            ))}
          </ul>
        ) : (
          <div className={`${LINE_GRID} items-center py-1.5`}>
            <PatchTag tag="fixed" t={t} className="justify-self-start max-sm:col-span-2" />
            <span className="line-clamp-1 text-[12.5px] leading-[1.45] text-cz-3 max-sm:line-clamp-2">
              {t("v2.fixesCount", { count: fixes.length })}: {fixes.map((it) => it.ti || it.b).join(" · ")}
            </span>
            <QuietButton chevron={null} onClick={() => toggle(fixKey)} aria-label={t("v2.showFixes", { area: areaLabel(area) })}
              className="max-sm:col-start-2 max-sm:row-start-2">
              {t("v2.show")}
            </QuietButton>
          </div>
        ))}
      </section>
    );
  });
}

/**
 * Variant B (en åbnet ældre uge eller måned, ejerens valg): én række pr. område med
 * det vigtigste og antal pr. mærke; tryk folder området ud.
 */
export function AreaRowsB({ items, t, liveFlags, marker, areaLabel, expanded, toggle, prefix }) {
  return (
    <ul>
      {groupByArea(items, liveFlags).map(([area, list]) => {
        const key = `${prefix}:b:${area}`;
        const open = expanded.has(key);
        const top = list.find((it) => tagOf(it, liveFlags) !== "fixed") || list[0];
        return (
          <li key={area} className="border-t border-cz-border first:border-t-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(key)}
              className={`grid w-full grid-cols-[150px_minmax(0,1fr)_16px] items-center gap-3 py-2.5 text-left max-sm:grid-cols-[minmax(0,1fr)_16px] max-sm:gap-y-1.5 ${TOUCH}`}
            >
              <span className="text-[13.5px] font-semibold text-cz-1">
                {areaLabel(area)} <span className="font-data text-2xs font-normal tabular-nums tracking-[.08em] text-cz-3">{list.length}</span>
              </span>
              <span className="min-w-0 max-sm:col-span-2 max-sm:row-start-2">
                <span className="flex min-w-0 items-center gap-2">
                  <PatchTag tag={tagOf(top, liveFlags)} t={t} />
                  <span className="truncate text-[13px] text-cz-1">{top.ti || top.b}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-2 font-data text-3xs uppercase tracking-[.06em] tabular-nums text-cz-3">
                  {countTags(list, liveFlags).map(([tag, n]) => (
                    <span key={tag}>{n} {t(`v2.tag.${tag}`)}</span>
                  ))}
                </span>
              </span>
              {open
                ? <ChevronDownIcon size={16} aria-hidden="true" className="text-cz-3 max-sm:col-start-2 max-sm:row-start-1" />
                : <ChevronRightIcon size={16} aria-hidden="true" className="text-cz-3 max-sm:col-start-2 max-sm:row-start-1" />}
            </button>
            {open && (
              <ul className="pb-2 sm:ps-[162px]">
                {list.map((it) => (
                  <PatchLine key={it.k} item={it} t={t} liveFlags={liveFlags} marker={marker}
                    open={expanded.has(`line:${it.k}`)} onToggle={() => toggle(`line:${it.k}`)} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
