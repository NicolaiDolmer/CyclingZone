import IconBase from "./IconBase.jsx";

export function SearchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  );
}

export function ChevronRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 6l6 6-6 6" />
    </IconBase>
  );
}

export function TrophyIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M10 17h4M12 13v4M9 21h6" />
    </IconBase>
  );
}

export function ChevronDownIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 9l6 6 6-6" />
    </IconBase>
  );
}

export function CheckIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M20 6L9 17l-5-5" />
    </IconBase>
  );
}

export function XIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </IconBase>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </IconBase>
  );
}

export function InfoIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </IconBase>
  );
}

export function InboxIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5 6h14l2 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-6z" />
    </IconBase>
  );
}

// --- Plan 2c: fuldt saet (hus-spec A8). Stroke-only geometrisk minimal linje;
//     IconBase ejer viewBox/stroke/fill/caps. Erstatter ALLE emoji (udrulning = Plan 4). ---

// Generelle
export function SettingsIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 2.5L20.2 7.25V16.75L12 21.5 3.8 16.75V7.25z" />
      <circle cx="12" cy="12" r="3.2" />
    </IconBase>
  );
}

export function BellIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 16l1-2V9a5 5 0 0 1 10 0v5l1 2z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </IconBase>
  );
}

export function ChevronUpIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 15l6-6 6 6" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M15 6l-6 6 6 6" />
    </IconBase>
  );
}

export function PlusIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function MinusIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function FilterIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 5h16l-6 7v6l-4-2v-4z" />
    </IconBase>
  );
}

export function SortIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M11 7L8 4 5 7M8 4v16" />
      <path d="M13 17l3 3 3-3M16 20V4" />
    </IconBase>
  );
}

export function CalendarIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </IconBase>
  );
}

export function TeamIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />
    </IconBase>
  );
}

export function UserIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </IconBase>
  );
}

export function EditIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" />
      <path d="M14 7l3 3" />
    </IconBase>
  );
}

export function TrashIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </IconBase>
  );
}

export function ExternalLinkIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </IconBase>
  );
}

export function EyeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function LockIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </IconBase>
  );
}

export function DownloadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

export function UploadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

export function ClockIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

export function StarIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z" />
    </IconBase>
  );
}

export function HeartIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11-8 11z" />
    </IconBase>
  );
}

export function MenuIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconBase>
  );
}

export function ArrowUpIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20V4M6 10l6-6 6 6" />
    </IconBase>
  );
}

export function ArrowDownIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 4v16M6 14l6 6 6-6" />
    </IconBase>
  );
}

export function CoinIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 8.5a4 4 0 1 0 0 7" />
      <path d="M7 11h6M7 13.5h5" />
    </IconBase>
  );
}

// Cykel-specifikke
export function TagIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M11 3H5a2 2 0 0 0-2 2v6l9 9 8-8z" />
      <circle cx="8" cy="8" r="1.5" />
    </IconBase>
  );
}

export function JerseyIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M8 4L3 9l2.5 2.5L7 10v10h10V10l1.5 1.5L21 9l-5-5a4 4 0 0 1-8 0z" />
    </IconBase>
  );
}

export function MountainIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 19l6-11 4 6 2-3 6 8z" />
    </IconBase>
  );
}

export function SprintIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 6l6 6-6 6M12 6l6 6-6 6" />
    </IconBase>
  );
}

export function TimeTrialIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="13" cy="13" r="7" />
      <path d="M13 9v4l3 2" />
      <path d="M3 9h4M2 13h4" />
    </IconBase>
  );
}

export function BikeIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="16" r="4" />
      <circle cx="18" cy="16" r="4" />
      <path d="M6 16l5-8h5M11 8l4 8M9 8h4" />
    </IconBase>
  );
}

export function RoadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 21L9 3h6l4 18z" />
      <path d="M12 7v3M12 14v3" />
    </IconBase>
  );
}

export function PodiumIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="9" y="8" width="6" height="13" />
      <rect x="3" y="13" width="6" height="8" />
      <rect x="15" y="15" width="6" height="6" />
    </IconBase>
  );
}

export function StopwatchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="14" r="7" />
      <path d="M12 14V10" />
      <path d="M10 3h4M12 3v2" />
      <path d="M18.5 8l1.5-1.5" />
    </IconBase>
  );
}

export function FlagIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 21V4" />
      <path d="M5 5h13l-2.5 4 2.5 4H5z" />
      <path d="M5 9h11M11.5 5v8" />
    </IconBase>
  );
}

// To-vejs udveksling (transfers/swaps — markeds-handler). Top-pil hoejre, bund-pil venstre.
export function ExchangeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 9h13M14 6l3 3-3 3" />
      <path d="M20 15H7M10 12l-3 3 3 3" />
    </IconBase>
  );
}

// Clipboard (survey/feedback). Board + clip; rect/path arver fill=none fra IconBase.
export function ClipboardIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </IconBase>
  );
}

// Lyn (bud/auktions-aktivitet). Erstatter ⚡-emoji som ikon (#671 Plan 4).
export function LightningIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </IconBase>
  );
}

// Retur-pil (tabt auktion / tilbagetrukket tilbud). Erstatter ↩-emoji.
export function UndoIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </IconBase>
  );
}

// Raket (sæson startet). Erstatter 🚀-emoji som linje-ikon.
export function RocketIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3c3 1.5 5 4.5 5 9l-2.5 2.5h-5L7 12c0-4.5 2-7.5 5-9z" />
      <circle cx="12" cy="9.5" r="1.5" />
      <path d="M9.5 14.5L7 17M14.5 14.5L17 17M11 17v3" />
    </IconBase>
  );
}

// Flame (login-streak). Stroke-only flamme + indre kerne. Erstatter 🔥-emoji (Plan 4).
export function FlameIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3c1 3-1.5 4-1.5 7a3 3 0 0 0 6 0c0-1-.5-2-1-2.5C16 11 17 13 17 15a5 5 0 0 1-10 0c0-4 3-5 5-12z" />
    </IconBase>
  );
}

// Crown (Hall of Fame). Tre takker + basisbjælke.
export function CrownIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5z" />
      <path d="M5 20h14" />
    </IconBase>
  );
}

// Open book (race-library/regelbog). To sider + ryg.
export function BookOpenIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v15" />
      <path d="M12 5a4 4 0 0 0-4-2H3v14h5a4 4 0 0 1 4 2" />
      <path d="M12 5a4 4 0 0 1 4-2h5v14h-5a4 4 0 0 0-4 2" />
    </IconBase>
  );
}

// Auction gavel (#1579 WP1: erstatter auktions-emoji). Hammer-hoved + skaft + sokkel.
export function GavelIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" />
      <path d="M9 8l6 6" />
      <path d="M13 4l7 7" />
      <path d="M16 5l3 3" />
      <path d="M4 22h8" />
    </IconBase>
  );
}

// Briefcase (#1579 WP1: transfers/kontrakter). Kasse + håndtag + skillelinje.
export function BriefcaseIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="18" height="13" rx="1.5" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </IconBase>
  );
}

// Discord-mærke (#1579 WP1: erstatter Discord-emoji). Forenklet stroke-blob med to øjne.
export function DiscordIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M7.5 16.5C5.6 14 5 10.2 6 6.6a13 13 0 0 1 4-1.1l.5 1a11 11 0 0 1 3 0l.5-1a13 13 0 0 1 4 1.1c1 3.6.4 7.4-1.5 9.9" />
      <path d="M7.5 16.5c1.4 1 3 1.5 4.5 1.5s3.1-.5 4.5-1.5" />
      <circle cx="9.5" cy="12" r="1" />
      <circle cx="14.5" cy="12" r="1" />
    </IconBase>
  );
}

// Globe (#1579 WP1: sprog-vælger). Cirkel + ækvator + meridian.
export function GlobeIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </IconBase>
  );
}
