import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMentionableManagers from "../../hooks/useMentionableManagers.js";
import { applyMentionSelection, filterMentionCandidates, findMentionQuery } from "../../lib/forumMentions.js";
import { menuClass, menuItemClass } from "../ui/menuStyles.js";

// #5011 (ejer-direktiv 3/9, #4751) — navneforslag mens man skriver "@..." i
// forummets editor.
//
// MONTERES SOM ÉN LINJE ved siden af det eksisterende felt:
//
//   <MentionAutocomplete textareaId="forum-reply-body" value={replyBody} onChange={setReplyBody} t={t} />
//
// Den ejer IKKE feltet: den finder det via `textareaId`, lytter med native
// events og skriver tilbage gennem `onChange`. Bevidst valg — editoren ligger
// i to sider (ForumPage's compose-modal og ForumPostPage's svarfelt) og røres
// samtidig af andet arbejde; en wrapper omkring <Textarea> ville gøre hver
// fremtidig editor-ændring til en konflikt. Her er berøringsfladen én linje.
//
// Panelet er `fixed` og placeres ud fra feltets rect, ikke som et
// absolut-barn: feltet sidder i en modal med sin egen scroll og sit eget
// stacking-context, og et absolut-barn ville enten blive klippet af eller
// skubbe formularen ned hver gang listen åbnede. `z-dropdown` (token-skalaen,
// #2880) ligger over sidens indhold og — inde i modalen — over modalens eget
// lag, fordi panelet lever i modalens stacking-context.
//
// Stylingen genbruges fra <Menu> (menuStyles.js): samme hairline-ramme, samme
// 5px radius, samme aktiv-tilstand som appens øvrige dropdowns. Ingen ny
// visuel dialekt.

// ~6 rækker + overskriftslinjen. Panelet må aldrig dække hele skærmen på 390px.
const PANEL_MAX_HEIGHT = 232;
const PANEL_GAP = 4;
// Panelet følger feltets venstrekant, men ikke dets bredde: et 1330px bredt
// felt ville give én kort navnerække strakt over hele skærmen. Det er et
// navneopslag, ikke en tabel.
const PANEL_MAX_WIDTH = 320;

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return a.left === b.left && a.width === b.width && a.top === b.top && a.bottom === b.bottom;
}

export default function MentionAutocomplete({ textareaId, value, onChange, t }) {
  const managers = useMentionableManagers();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  // Escape (og et netop valgt navn) lukker listen indtil man skriver videre.
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState(null);

  const elRef = useRef(null);
  const pendingCaretRef = useRef(null);
  const stateRef = useRef({});

  const selection = useMemo(
    () => (focused && !dismissed ? findMentionQuery(value, caret) : null),
    [focused, dismissed, value, caret],
  );
  const query = selection?.query ?? null;
  const suggestions = useMemo(
    () => (selection ? filterMentionCandidates(managers, selection.query) : []),
    [selection, managers],
  );
  const open = suggestions.length > 0 && anchor != null;
  const activeSafeIndex = suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);

  // Nyt "@..."-ord → forvalget starter forfra på det første navn.
  useEffect(() => { setActiveIndex(0); }, [query]);

  const choose = useCallback((manager) => {
    const s = stateRef.current;
    if (!manager || !s.selection) return;
    const next = applyMentionSelection(s.value, s.selection, manager.name);
    pendingCaretRef.current = next.caret;
    // Luk med det samme: uden dette ville det netop indsatte navn selv matche
    // og listen blive stående åben oven på det man skriver videre.
    setDismissed(true);
    s.onChange?.(next.text);
  }, []);

  // Seneste værdier til de native listeners, som kun bindes én gang.
  useEffect(() => {
    stateRef.current = { suggestions, activeIndex: activeSafeIndex, open, value, selection, onChange, choose };
  });

  // Caret'en sættes EFTER at React har skrevet den nye tekst i feltet — derfor
  // er `value` afhængigheden: valget af et navn ændrer netop den.
  useEffect(() => {
    const position = pendingCaretRef.current;
    if (position == null) return;
    pendingCaretRef.current = null;
    const el = elRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(position, position);
    setCaret(position);
  }, [value]);

  useEffect(() => {
    const el = typeof document === "undefined" ? null : document.getElementById(textareaId);
    if (!el) return undefined;
    elRef.current = el;

    const syncCaret = () => setCaret(el.selectionStart ?? 0);
    const handleFocus = () => { setFocused(true); syncCaret(); };
    const handleBlur = () => setFocused(false);
    const handleInput = () => { setDismissed(false); syncCaret(); };
    const handleKeyDown = (e) => {
      const s = stateRef.current;
      if (!s.open || s.suggestions.length === 0) return;
      const count = s.suggestions.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + count) % count);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        s.choose(s.suggestions[s.activeIndex]);
      } else if (e.key === "Escape") {
        // stopPropagation: Escape må lukke LISTEN uden også at lukke
        // compose-modalen den står i.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
      }
    };

    el.addEventListener("focus", handleFocus);
    el.addEventListener("blur", handleBlur);
    el.addEventListener("input", handleInput);
    el.addEventListener("keyup", syncCaret);
    el.addEventListener("click", syncCaret);
    el.addEventListener("keydown", handleKeyDown);
    if (document.activeElement === el) handleFocus();

    return () => {
      el.removeEventListener("focus", handleFocus);
      el.removeEventListener("blur", handleBlur);
      el.removeEventListener("input", handleInput);
      el.removeEventListener("keyup", syncCaret);
      el.removeEventListener("click", syncCaret);
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [textareaId]);

  // Placeringen måles på feltet og følger med ved scroll/resize. Er der ikke
  // plads under feltet (svarfeltet ligger nederst på siden, og mobilens
  // bundnavigation tager de sidste ~72px), vendes panelet op over feltet.
  useEffect(() => {
    if (suggestions.length === 0) {
      setAnchor((prev) => (prev === null ? prev : null));
      return undefined;
    }
    const el = elRef.current;
    if (!el || typeof window === "undefined") return undefined;
    const update = () => {
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const next = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP
        ? { left: r.left, width: r.width, top: null, bottom: window.innerHeight - r.top + PANEL_GAP }
        : { left: r.left, width: r.width, top: r.bottom + PANEL_GAP, bottom: null };
      setAnchor((prev) => (sameRect(prev, next) ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [suggestions.length]);

  // Skærmlæsere: feltet fortæller selv at der er en liste, og hvilket navn der
  // er forvalgt. Attributterne sættes imperativt, fordi komponenten med vilje
  // ikke ejer <Textarea> (se blokken øverst).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      el.setAttribute("aria-controls", `${textareaId}-mentions`);
      el.setAttribute("aria-activedescendant", `${textareaId}-mention-${activeSafeIndex}`);
    } else {
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-activedescendant");
    }
    return undefined;
  }, [open, activeSafeIndex, textareaId]);

  if (!open) return null;

  return (
    <div
      className={`fixed z-dropdown overflow-y-auto ${menuClass()}`}
      style={{
        left: anchor.left,
        width: Math.min(anchor.width, PANEL_MAX_WIDTH),
        maxHeight: PANEL_MAX_HEIGHT,
        ...(anchor.top == null ? { bottom: anchor.bottom } : { top: anchor.top }),
      }}
    >
      {/* Overskriften står UDEN FOR listboxen: et <p> som barn af role="listbox"
          er ugyldig ARIA (kun options må ligge der). */}
      <p
        id={`${textareaId}-mentions-label`}
        className="px-2.5 pb-1 pt-0.5 font-data text-2xs uppercase tracking-[.08em] text-cz-3"
      >
        {t("mentions.listLabel")}
      </p>
      <div id={`${textareaId}-mentions`} role="listbox" aria-labelledby={`${textareaId}-mentions-label`}>
        {suggestions.map((manager, i) => (
          <button
            key={manager.team_id || manager.name}
            id={`${textareaId}-mention-${i}`}
            type="button"
            role="option"
            aria-selected={i === activeSafeIndex}
            // onMouseDown frem for onClick: et klik ville først tage fokus fra
            // feltet (blur → listen lukker) og aldrig nå frem til handleren.
            onMouseDown={(e) => { e.preventDefault(); choose(manager); }}
            onMouseEnter={() => setActiveIndex(i)}
            className={menuItemClass({ active: i === activeSafeIndex })}
          >
            <span className="truncate">{manager.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
