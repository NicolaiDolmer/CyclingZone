// Desktop frames — T1 (Board, header A/B), T2 (Riders wide data), T3 (Rider profile).
const { Button, Icon, StatusBadge, CategoryTag, Avatar, ProgressMeter, Select, Input, Checkbox, Tabs, TabList, Tab } = window.CyclingZoneDesignSystem_a332ec;

function FrameShell({ active, children }) {
  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg-body)" }}>
      <TplSidebar active={active} />
      <main style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>{children}</main>
    </div>
  );
}

/* ── Template 1 · Standard content page (Board) ── */
function FrameT1({ variant }) {
  const actions = <HeaderActions options={["Season 1", "Season 0 — archive"]} primary="Request meeting" />;
  return (
    <FrameShell active="Board">
      <div style={{ maxWidth: 896, margin: "0 auto", padding: "28px 32px 64px" }}>
        {variant === "B"
          ? <HeaderB eyebrow="Klubhus · Pavé Collective" title="Board" sub="Season goals and the board's patience — reviewed after every race block." actions={actions} />
          : <HeaderA title="Board" sub="Season goals and the board's patience — reviewed after every race block." actions={actions} />}
        <BoardContent />
      </div>
    </FrameShell>
  );
}

/* ── Template 2 · Wide data page (Riders market) ── */
function FilterBar() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 1600, marginBottom: 16, flexWrap: "nowrap" }}>
      <div style={{ width: 240, flex: "none" }}><Input size="sm" placeholder="Search riders or teams" /></div>
      <Select size="sm" style={{ width: 148 }}><option>All specialties</option><option>GC</option><option>Climber</option><option>Sprinter</option></Select>
      <Select size="sm" style={{ width: 136 }}><option>All divisions</option><option>Division 1</option><option>Division 2</option></Select>
      <Select size="sm" style={{ width: 168 }}><option>Sort: OVR high → low</option><option>Sort: value</option><option>Sort: ends soonest</option></Select>
      <span style={{ flex: "none", whiteSpace: "nowrap" }}><Checkbox label="Free agents only" /></span>
      <span className="font-data" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}>412 listed · window closes in 2 days</span>
    </div>
  );
}
function FrameT2() {
  return (
    <FrameShell active="Riders">
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "28px 32px 48px" }}>
        <HeaderA title="Riders" sub="Transfer market — every listing in the current window." mb={20}
          actions={<HeaderActions options={["Window: open", "Window: deadline day"]} primary="Create listing" />} />
        <FilterBar />
        <RidersTable />
        <div className="font-data" style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
          <span>Showing 8 of 412 riders</span>
          <span>Row tints — market zones, same recipe as standings promotion / relegation</span>
        </div>
      </div>
    </FrameShell>
  );
}

/* ── Template 3 · Profile / detail (Rider) ── */
const T3_RESULTS = [
  { icon: "mountain", race: "Tour des Fjords", tag: "Stage 14 · HC summit", pos: "2nd", pts: "+48", top: true },
  { icon: "sprint", race: "Tour des Fjords", tag: "Stage 12 · flat", pos: "41st", pts: "+2" },
  { icon: "time-trial", race: "Chrono de Malmö", tag: "ITT · 32 km", pos: "18th", pts: "+12" },
  { icon: "mountain", race: "Vuelta a Serranía", tag: "Stage 9 · MTF", pos: "5th", pts: "+28" },
  { icon: "road", race: "Paris–Nordhavn", tag: "One-day · 1.HC", pos: "23rd", pts: "+6" },
];
function ContractRow({ label, value, first }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <span className="font-data" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>{label}</span>
      <span className="font-data" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{value}</span>
    </div>
  );
}
function FrameT3() {
  return (
    <FrameShell active="Riders">
      <div style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1024, margin: "0 auto", padding: "20px 32px 0" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginBottom: 14, cursor: "pointer" }}><Icon name="chevron-left" size={13} /> Riders</span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Avatar name="Lorenzo Vidal" size="lg" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <CategoryTag>Climber</CategoryTag>
                <CategoryTag>ESP</CategoryTag>
                <span className="font-data" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>Nordlys CC · Division 1 · Age 24</span>
              </div>
              <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 40, lineHeight: .92, letterSpacing: ".01em", fontWeight: 400, color: "var(--text-1)", textTransform: "uppercase" }}>Lorenzo Vidal</h1>
            </div>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              <Button size="sm" variant="secondary" iconLeft={<Icon name="star" size={14} />}>Watchlist</Button>
              <Button size="sm">Make offer</Button>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <StatBlock label="OVR" value="82" />
            <StatBlock label="Form" value="91" sub="▲ 6 this block" subTone="success" />
            <StatBlock label="Season pts" value="312" />
            <StatBlock label="Wins" value="2" />
            <StatBlock label="Value" value="CZ$ 1,340,000" />
            <StatBlock label="Wage" value="CZ$ 9,400" sub="per week" last />
          </div>
          <div style={{ marginTop: 12, marginBottom: -1 }}>
            <Tabs value="overview" onChange={() => {}}>
              <TabList label="Rider sections">
                <Tab value="overview">Overview</Tab>
                <Tab value="results">Results</Tab>
                <Tab value="contract">Contract</Tab>
                <Tab value="history">History</Tab>
              </TabList>
            </Tabs>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 1024, margin: "0 auto", padding: "24px 32px 64px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionCard title="Recent results" meta="Last 5 starts">
              {T3_RESULTS.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <span style={{ width: 34, height: 34, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 8, color: "rgb(var(--accent-t))" }}><Icon name={r.icon} size={17} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{r.race}</div>
                    <div className="font-data" style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 1 }}>{r.tag}</div>
                  </div>
                  <span className="font-data" style={{ fontSize: 14, fontWeight: 700, color: r.top ? "rgb(var(--accent-t))" : "var(--text-1)", width: 44, textAlign: "right" }}>{r.pos}</span>
                  <span className="font-data" style={{ fontSize: 12, color: "var(--text-2)", width: 36, textAlign: "right" }}>{r.pts}</span>
                </div>
              ))}
            </SectionCard>
            <SectionCard title="Next start" meta="Stage 15 · in 2 days">
              <StageProfile />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>Tour des Fjords — Fjellhøgda summit</div>
                  <div className="font-data" style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>182 km · 3,940 m elevation · HC finish</div>
                </div>
                <QuietLink>Set tactics</QuietLink>
              </div>
            </SectionCard>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionCard title="Attributes" meta="0–100">
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <ProgressMeter label="Climbing" value={88} showValue />
                <ProgressMeter label="Endurance" value={84} showValue />
                <ProgressMeter label="Time trial" value={71} showValue />
                <ProgressMeter label="Sprint" value={42} showValue />
              </div>
            </SectionCard>
            <SectionCard title="Contract">
              <ContractRow label="Wage" value="CZ$ 9,400 / wk" first />
              <ContractRow label="Expires" value="End of Season 2" />
              <ContractRow label="Release clause" value="CZ$ 1,900,000" />
              <ContractRow label="Signed via" value="Auction · Season 1" />
            </SectionCard>
          </div>
        </div>
      </div>
    </FrameShell>
  );
}

Object.assign(window, { FrameShell, FrameT1, FrameT2, FrameT3, FilterBar });
