import { tagOf, isNewSince, PATCH_NOTE_CATEGORIES, patchNoteCategory } from "../../lib/patchNotes.js";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRightIcon, ChevronDownIcon } from "../ui";

/** Et punkt fra patch-notes-data (kompakte nøgler, se lib/patchNotes.js). */
export interface PatchItem {
  k: string; v?: string; d: string; s?: string; a: string; c?: string; ti?: string; b?: string;
  r?: string; f?: string; fb?: string; img?: string; hl?: boolean; rp?: string;
}
export type Translate = { (key: string): string; (key: string, opts: Record<string, unknown>): string };
export type LiveFlags = Record<string, boolean> | null;
type AreaLabel = (area: string) => string;

interface NotesContext {
  t: Translate;
  liveFlags: LiveFlags;
  marker: string | null;
  areaLabel: AreaLabel;
  dateLabel: (date: string) => string;
}

// Rolloutmærker og kategorier beskriver forskellige ting.
const TAG_TONE = {
  on: "border-cz-success/45 text-cz-success",
  beta: "border-cz-warning/50 text-cz-warning",
};

// Mobil: trykflader mindst 44 x 44 (P16), samme medie-betingelse som knap-kittet.
export const TOUCH = "[@media(max-width:640px),(pointer:coarse)]:min-h-11";

export function PatchTag({ tag, t, className = "" }: { tag: keyof typeof TAG_TONE; t: Translate; className?: string }) {
  return (
    <span
      data-tag={tag}
      className={`inline-flex h-5 items-center justify-center whitespace-nowrap rounded-cz border px-1.5 font-data text-3xs font-semibold ${TAG_TONE[tag]} ${className}`}
    >
      {t(`v2.tag.${tag}`)}
    </span>
  );
}

export function NewDot() {
  return <span className="inline-flex h-[7px] w-[7px] shrink-0 rounded-cz-pill bg-cz-accent" aria-hidden="true" />;
}

export function QuietButton({ children, className = "", chevron = "right", ...rest }: {
  children: ReactNode; className?: string; chevron?: "right" | "down" | "";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
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

export function DisclosureLabel({ label, open, locale }: { label: string; open: boolean; locale: string }) {
  const Icon = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-cz-accent-t">
      {label.charAt(0).toLocaleLowerCase(locale) + label.slice(1)}
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}

function FallbackNote({ item, t }: { item: PatchItem; t: Translate }) {
  if (!item.fb) return null;
  return <span className="ms-1 text-xs text-cz-3">({t(`fallbackLang.${item.fb}`)})</span>;
}

// Noter med godkendte genveje beholder dem, når de fremhæves i denne uge.
const HIGHLIGHT_LINKS: Readonly<Partial<Record<string, { game?: string; help?: string }>>> = {
  "7.451#0": { game: "/training", help: "/help?section=dailytraining" },
};

export function PatchNote({ item, t, liveFlags, marker, areaLabel, dateLabel, highlighted = false, showCategory = false, heading: Heading = "h4", action }: NotesContext & {
  item: PatchItem;
  highlighted?: boolean;
  showCategory?: boolean;
  heading?: "h3" | "h4" | "h5";
  action?: ReactNode;
}) {
  const tag = tagOf(item, liveFlags);
  const links = highlighted ? HIGHLIGHT_LINKS[item.k] : undefined;
  const image = highlighted ? item.img : undefined;
  return (
    <li className="border-t border-cz-border py-[13px]">
      <article>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-data text-xs text-cz-2">
          <time dateTime={item.d} className="tabular-nums">{dateLabel(item.d)}</time>
          {showCategory && <span>{t(`category.${patchNoteCategory(item)}`)}</span>}
          <span>{areaLabel(item.a)}</span>
          {(tag === "on" || tag === "beta") && <PatchTag tag={tag} t={t} />}
          {isNewSince(item, marker) && (
            <span className="inline-flex items-center gap-1.5">
              <NewDot />{t("v2.newDot")}
            </span>
          )}
        </div>
        <Heading className="mt-1.5 text-[13.5px] font-semibold leading-snug text-cz-1">
          {item.ti || item.b}
          <FallbackNote item={item} t={t} />
        </Heading>
        {item.b && item.b !== item.ti && item.ti && (
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-cz-2">{item.b}</p>
        )}
        {image && (
          <img
            src={image}
            alt={t("v2.heroImageAlt", { title: item.ti })}
            width={640}
            height={310}
            loading="lazy"
            decoding="async"
            className="mt-2.5 h-auto w-full max-w-sm rounded-cz border border-cz-border"
          />
        )}
        {links && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4">
            {links.game && <NoteLink to={links.game}>{t("v2.heroGameLink")}</NoteLink>}
            {links.help && <NoteLink to={links.help}>{t("v2.heroHelpLink")}</NoteLink>}
          </div>
        )}
        {action}
      </article>
    </li>
  );
}

function NoteLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-1 text-xs font-medium text-cz-accent-t hover:underline ${TOUCH}`}>
      {children}
      <ChevronRightIcon size={13} aria-hidden="true" />
    </Link>
  );
}

export function PatchNoteGroups({ items, highlightedKey, archive = false, ...context }: NotesContext & {
  items: PatchItem[];
  highlightedKey?: string;
  archive?: boolean;
}) {
  const CategoryHeading = archive ? "h4" : "h3";
  return PATCH_NOTE_CATEGORIES.map((category) => {
    const notes = items.filter((item) => patchNoteCategory(item) === category);
    if (!notes.length) return null;
    const label = context.t(`category.${category}`);
    return (
      <section key={category} className="[&+section]:mt-3" aria-label={label}>
        <CategoryHeading className="mb-1.5 text-[15px] font-semibold text-cz-1">{label}</CategoryHeading>
        <ul>
          {notes.map((item) => (
            <PatchNote
              key={item.k}
              item={item}
              heading={archive ? "h5" : "h4"}
              highlighted={item.k === highlightedKey}
              {...context}
            />
          ))}
        </ul>
      </section>
    );
  });
}
