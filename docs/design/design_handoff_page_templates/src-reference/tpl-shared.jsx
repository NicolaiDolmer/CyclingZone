// Shared template parts — data, sidebar, headers, section card, riders table, board content.
const DSx = window.CyclingZoneDesignSystem_a332ec;
const { Button, Card, Icon, StatusBadge, CategoryTag, Avatar, ProgressMeter, Skeleton, Table, Tr, Th, Td, JerseyDot, Select, Input, Checkbox, EmptyState, ErrorState } = DSx;

const fmt = n => n.toLocaleString("en-US");
const CZ = n => `CZ$ ${fmt(n)}`;

/* ── Sidebar (static recreation of the kit's Layout) ── */
const TPL_NAV = [
  { label: "Klubhus", items: ["Dashboard", "Team", "Training", "Board", "Finance", "Notifications"] },
  { label: "Marked", items: ["Riders", "Auctions", "Transfers", "Deadline day", "Watchlist"] },
  { label: "Season & results", items: ["Results", "Standings", "Rider rankings", "Races"] },
  { label: "League", items: ["Teams", "Head to head"] },
];
function TplSidebar({ active }) {
  return (
    <aside style={{ width: "var(--sidebar-width)", flex: "none", height: "100%", background: "var(--bg-sidebar)", borderRight: "1px solid var(--border-sidebar)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 16, borderBottom: "1px solid var(--border-sidebar)" }}>
        <div style={{ minWidth: 0 }}>
          <img src="assets/brand/wordmark-ondark.svg" alt="Cycling Zone" style={{ height: 20, width: "auto", display: "block" }} />
          <p style={{ margin: "4px 0 0", color: "var(--text-sidebar-3)", fontSize: 10, whiteSpace: "nowrap" }}>Pavé Collective</p>
        </div>
      </div>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-sidebar)" }}>
        <p style={{ margin: 0, fontSize: 9, color: "var(--text-sidebar-3)", textTransform: "uppercase", letterSpacing: ".15em" }}>Balance</p>
        <p className="font-data" style={{ margin: "2px 0 0", color: "rgb(var(--accent))", fontWeight: 700, fontSize: 14 }}>1,284,500 CZ$</p>
        <p style={{ margin: "2px 0 0", color: "var(--text-sidebar-3)", fontSize: 10 }}>Division 1</p>
      </div>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-sidebar)", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }}></span>
        <span style={{ color: "var(--text-sidebar-3)", fontSize: 10 }}>148 managers online now</span>
      </div>
      <nav style={{ flex: 1, overflow: "hidden", padding: "8px 0" }}>
        {TPL_NAV.map(g => (
          <div key={g.label} style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 4px" }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--text-sidebar-3)" }}>{g.label}</span>
              <span style={{ fontSize: 8, color: "var(--text-sidebar-3)", transform: "rotate(180deg)" }}>▾</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0" }}>
              {g.items.map(it => (
                <span key={it} className={`cz-nav-item${it === active ? " is-active" : ""}`}>
                  <span className="cz-nav-item__left"><span className="cz-nav-item__bullet"></span><span className="cz-nav-item__label">{it}</span></span>
                  {it === "Notifications" && <span className="cz-nav-item__badge">3</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

/* ── Mobile top bar ── */
function MobileBar() {
  return (
    <div style={{ height: 52, flex: "none", background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border-sidebar)", display: "flex", alignItems: "center", gap: 12, padding: "0 14px" }}>
      <span style={{ color: "var(--text-sidebar-1)", display: "inline-flex" }}><Icon name="menu" size={20} /></span>
      <img src="assets/brand/wordmark-ondark.svg" alt="Cycling Zone" style={{ height: 16 }} />
      <span style={{ flex: 1 }}></span>
      <span className="font-data" style={{ color: "rgb(var(--accent))", fontSize: 12, fontWeight: 700 }}>1,284,500 CZ$</span>
      <span style={{ color: "var(--text-sidebar-2)", display: "inline-flex" }}><Icon name="bell" size={18} /></span>
    </div>
  );
}

/* ── Page headers — the two candidate recipes ── */
function HeaderActions({ options, primary }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      <Select size="sm" style={{ width: 150 }} defaultValue={options[0]}>{options.map(o => <option key={o}>{o}</option>)}</Select>
      <Button size="sm">{primary}</Button>
    </div>
  );
}
function HeaderA({ title, sub, actions, mb = 24 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: mb }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="font-data" style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)", lineHeight: 1.2 }}>{title}</h1>
        {sub && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-2)" }}>{sub}</p>}
      </div>
      {actions}
    </div>
  );
}
function HeaderB({ eyebrow, title, sub, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 28, paddingBottom: 18, borderBottom: "1px solid var(--text-1)" }}>
      <div style={{ minWidth: 0 }}>
        <p className="cz-eyebrow" style={{ margin: "0 0 8px" }}>{eyebrow}</p>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 38, lineHeight: .95, letterSpacing: ".01em", fontWeight: 400, color: "var(--text-1)", textTransform: "uppercase" }}>{title}</h1>
        {sub && <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-2)" }}>{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

/* ── Canonical section card: pad 20 (16 mobile), one header recipe ── */
function QuietLink({ children }) {
  return <span style={{ color: "rgb(var(--accent-t))", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>{children}<Icon name="chevron-right" size={13} /></span>;
}
function SectionCard({ title, meta, action, pad = 20, style, children }) {
  return (
    <Card style={{ padding: pad, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{title}</h2>
        {action ? action : meta ? <span className="font-data" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>{meta}</span> : null}
      </div>
      {children}
    </Card>
  );
}

/* ── Small data bits ── */
function ZonePill({ tone, children }) {
  const c = tone === "up" ? "success" : "danger";
  return <span className="font-data" style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", padding: "2px 6px", borderRadius: 4, background: `var(--${c}-bg)`, color: `rgb(var(--${c}))`, whiteSpace: "nowrap" }}>{children}</span>;
}
const SPARKS = {
  up: "0,18 14,15 28,16 42,10 56,11 70,6 84,4",
  down: "0,5 14,8 28,7 42,12 56,11 70,15 84,18",
  flat: "0,12 14,10 28,13 42,11 56,12 70,10 84,12",
};
function Spark({ dir }) {
  const col = dir === "up" ? "rgb(var(--success))" : dir === "down" ? "rgb(var(--danger))" : "var(--text-3)";
  return <svg width="64" height="20" viewBox="0 0 84 22" style={{ display: "block" }}><polyline points={SPARKS[dir]} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></polyline></svg>;
}
function StatBlock({ label, value, sub, subTone, last }) {
  return (
    <div style={{ paddingRight: last ? 0 : 24, marginRight: last ? 0 : 24, borderRight: last ? "none" : "1px solid var(--border)" }}>
      <div className="font-data" style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      <div className="font-data" style={{ fontSize: 20, fontWeight: 650, color: "var(--text-1)", lineHeight: 1.1, whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div className="font-data" style={{ marginTop: 3, fontSize: 11, color: subTone ? `rgb(var(--${subTone}))` : "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}

/* ── Board (template 1) content ── */
const GOALS = [
  { t: "Finish top 4 in Division 1", m: "Currently 2nd · reward CZ$ 120,000", v: 72, tone: "accent", s: "won", label: "On track" },
  { t: "Win 6 races this season", m: "4 of 6 · stage 14 of 38", v: 67, tone: "accent", s: "won", label: "On track" },
  { t: "Develop a U23 rider to 75 OVR", m: "Best — Lars Dybkær, 68", v: 44, tone: "danger", s: "outbid", label: "Behind" },
  { t: "Keep weekly wages under CZ$ 48,000", m: "Now CZ$ 46,900", v: 90, tone: "accent", s: "closing", label: "At risk" },
];
function GoalRow({ g, compact, first }) {
  return compact ? (
    <div style={{ padding: "12px 0", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{g.t}</span>
        <StatusBadge state={g.s}>{g.label}</StatusBadge>
      </div>
      <div className="font-data" style={{ margin: "3px 0 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>{g.m}</div>
      <ProgressMeter value={g.v} tone={g.tone} ariaLabel={g.t} />
    </div>
  ) : (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 88px", alignItems: "center", gap: 20, padding: "13px 0", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-1)" }}>{g.t}</div>
        <div className="font-data" style={{ marginTop: 3, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>{g.m}</div>
      </div>
      <ProgressMeter value={g.v} tone={g.tone} ariaLabel={g.t} />
      <div style={{ textAlign: "right" }}><StatusBadge state={g.s}>{g.label}</StatusBadge></div>
    </div>
  );
}
function BoardContent({ pad = 20, compact }) {
  return (
    <React.Fragment>
      <SectionCard title="Season goals" pad={pad} action={<QuietLink>Goal history</QuietLink>}>
        {GOALS.map((g, i) => <GoalRow key={g.t} g={g} compact={compact} first={i === 0} />)}
      </SectionCard>
      <SectionCard title="Board satisfaction" pad={pad} meta="Updated after stage 14" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ProgressMeter label="Results" value={74} showValue />
          <ProgressMeter label="Finances" value={86} showValue />
          <ProgressMeter label="Squad development" value={54} tone="danger" showValue />
          <ProgressMeter label="Fan support" value={63} showValue />
        </div>
        <div className="cz-divider--plain" style={{ margin: "18px 0 16px" }}></div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ color: "rgb(var(--accent-t))", marginTop: 2, flex: "none" }}><Icon name="clipboard" size={18} /></span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>The board is satisfied — for now.</div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, maxWidth: "62ch" }}>Second place buys patience. Deliver a mountain win before stage 24 and the winter budget grows — miss the U23 goal and it doesn't. — Chairman E. Brandt</p>
          </div>
        </div>
      </SectionCard>
    </React.Fragment>
  );
}

/* ── Riders market (template 2) data + table ── */
const TYPE_COLOR = { GC: "#e8c547", Sprinter: "#60a5fa", Climber: "#a78bfa", Domestique: "#15772f", Puncheur: "#f472b6", "Time trial": "#34d399" };
const RIDERS = [
  { n: "Ineke van Dijk", team: "Vélo Rosso", nat: "NED", age: 27, type: "GC", ovr: 84, form: 91, dir: "up", val: 1720000, wage: 11200, con: "S3", zone: "up", pill: "New" },
  { n: "Aoife Brennan", team: "Free agent", nat: "IRL", age: 23, type: "Climber", ovr: 79, form: 85, dir: "up", val: 860000, wage: 5900, con: "—", zone: "up", pill: "New" },
  { n: "Tomas Reyes", team: "Team Helios", nat: "ESP", age: 29, type: "Sprinter", ovr: 81, form: 74, dir: "flat", val: 940000, wage: 7400, con: "S2" },
  { n: "Émile Rousseau", team: "Granfondo Racing", nat: "FRA", age: 26, type: "Puncheur", ovr: 77, form: 80, dir: "up", val: 720000, wage: 5100, con: "S2" },
  { n: "Jens Halvorsen", team: "Nordlys CC", nat: "NOR", age: 31, type: "Time trial", ovr: 80, form: 66, dir: "down", val: 690000, wage: 6800, con: "S1" },
  { n: "Dario Colombo", team: "Maglia Nera", nat: "ITA", age: 25, type: "Sprinter", ovr: 74, form: 72, dir: "flat", val: 480000, wage: 3900, con: "S2" },
  { n: "Květa Horák", team: "Granfondo Racing", nat: "CZE", age: 28, type: "Climber", ovr: 83, form: 58, dir: "down", val: 1340000, wage: 9700, con: "S1", zone: "end", pill: "Ends 0:42", zTop: true },
  { n: "Magnus Lie", team: "Free agent", nat: "NOR", age: 33, type: "Domestique", ovr: 68, form: 52, dir: "down", val: 310000, wage: 2600, con: "—", zone: "end", pill: "Ends 1:15" },
];
function RiderCell({ r, compact }) {
  return (
    <React.Fragment>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 500, color: "var(--text-1)", fontSize: compact ? 12.5 : 13.5, whiteSpace: "nowrap" }}>
        <JerseyDot color={TYPE_COLOR[r.type]} title={r.type} /> {r.n}
      </span>
      <span className="font-data" style={{ display: "block", marginTop: 2, paddingLeft: 17, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)", whiteSpace: "nowrap" }}>
        {compact ? `${r.type} · ${r.age} · ${r.team}` : `${r.nat} · ${r.team}`}
      </span>
    </React.Fragment>
  );
}
function RidersTable({ compact }) {
  const rowCls = r => [r.zone === "up" ? "tpl-row--up" : "", r.zone === "end" ? "tpl-row--end" : "", r.zTop ? "tpl-zone-top" : "", r.pill === "New" && r.n === "Aoife Brennan" ? "tpl-zone-bottom" : ""].filter(Boolean).join(" ");
  return (
    <Table className={compact ? "tpl-table tpl-table--m" : "tpl-table"}>
      <thead>
        <Tr>
          <Th className="tpl-stick">Rider</Th>
          {!compact && <Th numeric>Age</Th>}
          {!compact && <Th>Type</Th>}
          <Th numeric>OVR</Th>
          <Th>Form</Th>
          <Th numeric>Value (CZ$)</Th>
          <Th numeric>Wage (CZ$/wk)</Th>
          {!compact && <Th>Contract</Th>}
          <Th>Listing</Th>
          <Th></Th>
        </Tr>
      </thead>
      <tbody>
        {RIDERS.map(r => (
          <Tr key={r.n} className={rowCls(r)}>
            <Td className="tpl-stick"><RiderCell r={r} compact={compact} /></Td>
            {!compact && <Td numeric>{r.age}</Td>}
            {!compact && <Td><CategoryTag>{r.type}</CategoryTag></Td>}
            <Td numeric strong><span className="font-data" style={{ fontWeight: 700 }}>{r.ovr}</span></Td>
            <Td><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Spark dir={r.dir} /><span className="font-data" style={{ fontSize: 12, color: "var(--text-2)" }}>{r.form}</span></span></Td>
            <Td numeric strong>{fmt(r.val)}</Td>
            <Td numeric>{fmt(r.wage)}</Td>
            {!compact && <Td><span className="font-data" style={{ fontSize: 12 }}>{r.con}</span></Td>}
            <Td>{r.pill ? <ZonePill tone={r.zone}>{r.pill}</ZonePill> : <span style={{ color: "var(--text-3)" }}>—</span>}</Td>
            <Td numeric style={{ paddingTop: 8, paddingBottom: 8 }}><Button size="sm" variant="secondary">{r.team === "Free agent" ? "Offer" : "Bid"}</Button></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/* ── Stage profile (data-as-imagery motif) ── */
function StageProfile() {
  return (
    <div>
      <svg viewBox="0 0 420 96" style={{ display: "block", width: "100%", height: 86 }} preserveAspectRatio="none">
        <path d="M0,88 L30,80 60,82 95,64 120,68 150,46 175,52 205,30 235,40 265,22 300,34 330,18 360,26 392,8 416,4 L416,96 L0,96 Z" fill="var(--bg-subtle)" stroke="none"></path>
        <path d="M0,88 L30,80 60,82 95,64 120,68 150,46 175,52 205,30 235,40 265,22 300,34 330,18 360,26 392,8 416,4" fill="none" stroke="var(--text-1)" strokeWidth="2" strokeLinejoin="round"></path>
        <line x1="416" y1="4" x2="416" y2="96" stroke="var(--text-1)" strokeWidth="2"></line>
      </svg>
      <div className="font-data" style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, letterSpacing: ".06em", color: "var(--text-3)", textTransform: "uppercase" }}>
        <span>0 km</span><span>60</span><span>120</span><span>182 km · fin</span>
      </div>
    </div>
  );
}

Object.assign(window, { DSx, fmt, CZ, TplSidebar, MobileBar, HeaderActions, HeaderA, HeaderB, QuietLink, SectionCard, ZonePill, Spark, StatBlock, GOALS, GoalRow, BoardContent, RIDERS, TYPE_COLOR, RiderCell, RidersTable, StageProfile });
