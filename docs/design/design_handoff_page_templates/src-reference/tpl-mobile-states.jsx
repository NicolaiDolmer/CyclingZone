// Mobile variants (375) + canonical states sheet + all mounts.
const { Button, Icon, Select, Input, Skeleton, EmptyState, ErrorState } = window.CyclingZoneDesignSystem_a332ec;

/* ── Template 1 · mobile ── */
function MobileT1() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-body)" }}>
      <MobileBar />
      <div style={{ flex: 1, overflow: "hidden", padding: "20px 16px 32px" }}>
        <h1 className="font-data" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>Board</h1>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-2)" }}>Goals and patience — reviewed after every race block.</p>
        <div style={{ display: "flex", gap: 8, margin: "14px 0 20px" }}>
          <Select size="sm" style={{ flex: 1 }} defaultValue="Season 1"><option>Season 1</option><option>Season 0 — archive</option></Select>
          <Button size="sm">Request meeting</Button>
        </div>
        <BoardContent pad={16} compact />
      </div>
    </div>
  );
}

/* ── Template 2 · mobile ── */
function MobileT2() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const sc = ref.current && ref.current.querySelector(".cz-table-wrap > div");
    if (sc) sc.scrollLeft = 104;
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-body)" }}>
      <MobileBar />
      <div ref={ref} style={{ flex: 1, overflow: "hidden", padding: "20px 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <h1 className="font-data" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>Riders</h1>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-2)" }}>412 listed · closes in 2 days</p>
          </div>
          <Button size="sm">Create listing</Button>
        </div>
        <div style={{ margin: "14px 0 8px" }}><Input size="sm" placeholder="Search riders or teams" /></div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Select size="sm" style={{ flex: 1 }}><option>All specialties</option></Select>
          <Select size="sm" style={{ flex: 1 }}><option>Sort: OVR</option></Select>
        </div>
        <RidersTable compact />
        <div className="font-data" style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)" }}>Showing 8 of 412 · rider column stays pinned</div>
      </div>
    </div>
  );
}

/* ── Canonical states sheet ── */
function StateCol({ step, note, lines, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="font-data" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--text-3)", marginBottom: 10 }}>{step}</div>
      {children}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <div className="font-data" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", marginBottom: 4 }}>{note}</div>
        {lines.map(l => <div key={l} className="font-data" style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.7 }}>{l}</div>)}
      </div>
    </div>
  );
}
function StatesSheet() {
  const cardH = { minHeight: 296, display: "flex", flexDirection: "column" };
  const center = { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" };
  return (
    <div style={{ height: "100%", background: "var(--bg-body)", padding: "32px 48px" }}>
      <p className="cz-eyebrow" style={{ margin: 0 }}>Canonical states</p>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-2)" }}>Section chrome always renders — only the card body swaps. One recipe each; these replace every hand-rolled variant.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 22 }}>
        <StateCol step="01 · Loading" note="Skeleton, never a spinner inside cards"
          lines={["cz-skeleton lines · 12px tall · 12px gap", "widths echo the real content (88 / 64 / 76 / 52%)", "shimmer 1.4s ease-in-out · radius 4"]}>
          <SectionCard title="Season goals" action={<QuietLink>Goal history</QuietLink>} style={cardH}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              <Skeleton style={{ height: 12, width: "88%" }} />
              <Skeleton style={{ height: 12, width: "64%" }} />
              <Skeleton style={{ height: 12, width: "76%" }} />
              <Skeleton style={{ height: 12, width: "52%" }} />
              <Skeleton style={{ height: 6, width: "100%", marginTop: 6 }} />
            </div>
          </SectionCard>
        </StateCol>
        <StateCol step="02 · Empty" note="Stroke icon · one sentence · one action"
          lines={["EmptyState — dashed inset on the card surface", "icon 26px in text-3 · title 15/600", "action is the section's primary, size sm"]}>
          <SectionCard title="Watchlist" meta="0 riders" style={cardH}>
            <div style={center}>
              <EmptyState icon={<Icon name="inbox" size={26} />} title="No riders yet"
                description="Draft your first rider in the live auction."
                action={<Button size="sm">Open auction</Button>} />
            </div>
          </SectionCard>
        </StateCol>
        <StateCol step="03 · Error" note="Danger icon · plain message · secondary retry"
          lines={["ErrorState — alert-triangle in danger, no red fills", "message says what is safe, sentence case", "retry is secondary — never gold"]}>
          <SectionCard title="Live market" meta="Disconnected" style={cardH}>
            <div style={center}>
              <ErrorState icon={<Icon name="alert-triangle" size={26} />} title="Couldn't load the market"
                description="Nothing was lost — your bids are safe."
                action={<Button size="sm" variant="secondary">Try again</Button>} />
            </div>
          </SectionCard>
        </StateCol>
      </div>
    </div>
  );
}

/* ── Mounts ── */
function mount(id, el) { const n = document.getElementById(id); if (n) ReactDOM.createRoot(n).render(el); }
mount("f-t1a", <FrameT1 variant="A" />);
mount("f-t2", <FrameT2 />);
mount("f-t3", <FrameT3 />);
mount("f-m1", <MobileT1 />);
mount("f-m2", <MobileT2 />);
mount("f-states", <StatesSheet />);
