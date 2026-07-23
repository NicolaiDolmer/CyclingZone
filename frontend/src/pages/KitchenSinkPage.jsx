import { useState } from "react";
import {
  Button, StatusBadge, CategoryTag, Card,
  Field, Input, Textarea, Select, Checkbox, Radio, Toggle,
  Table, Tr, Th, Td, JerseyDot,
  EmptyState, ErrorState, Skeleton, SkeletonLines, Spinner, Divider, Link,
  Modal, DialogSurface, Dropdown, MenuItem, Tooltip, Toast,
  Tabs, TabList, Tab, TabPanel,
  Chip, Avatar, ProgressMeter,
  PageHeader, Section as PageSection, SectionStack, SectionHeader, SectionAction,
  DataTable, ZonePill,
  ChevronRightIcon, TrophyIcon, InboxIcon,
} from "../components/ui/index.js";
import * as Icons from "../components/ui/icons/index.jsx";
import { useDocumentHead } from "../hooks/useDocumentHead.js";

// Hele ikon-saettet, alfabetisk (module-namespace -> sorterede noegler = stabilt snapshot).
const ICON_ENTRIES = Object.entries(Icons).filter(([name]) => name.endsWith("Icon"));

// #671 Plan 3 — gated forced-error-trigger til error-boundary-demo/-test.
// Kun naar `?boom=1` OG (dev eller e2e): aldrig i prod, og default-/ui
// (snapshot-target) er upaavirket. En render der kaster -> top-niveau-
// SentryBoundary fanger -> branded fallback.
const BOOM_ENABLED = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
function boomRequested() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("boom") === "1";
}
function Boom() {
  throw new Error("Kitchen-sink forced render error (error-boundary demo)");
}

function Section({ title, children }) {
  return (
    <section className="mb-12">
      <h2 className="mb-5 inline-block border-t-2 border-cz-accent pt-3 font-display text-2xl tracking-[.02em] text-cz-1">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

export default function KitchenSinkPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("roster");
  const [boom, setBoom] = useState(false);
  // #1404: /ui er en intern komponent-demo, public-reachable men ikke i sitemap.
  // noindex → ingen rod-canonical, holdes ude af søgeindekset.
  useDocumentHead({
    title: "UI kitchen sink · Cycling Zone",
    noindex: true,
  });
  return (
    <main className="mx-auto max-w-5xl px-10 py-12">
      <p className="mb-2 font-data text-xs font-semibold uppercase tracking-[.18em] text-cz-accent">
        Cycling Zone · UI-fundament
      </p>
      <h1 className="mb-10 font-display text-5xl leading-[.96] tracking-[.012em] text-cz-1">Kitchen sink</h1>

      <Section title="Buttons">
        <Button variant="primary">Place bid</Button>
        <Button variant="secondary">Watch rider</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Release rider</Button>
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary" size="lg">Large</Button>
        <Button variant="primary" iconRight={<ChevronRightIcon size={15} />}>With icon</Button>
        <Button variant="primary" disabled>Disabled</Button>
        <Button variant="primary" loading>Placing</Button>
      </Section>

      <Section title="Status (broadcast)">
        <StatusBadge state="live" pulse>Live</StatusBadge>
        <StatusBadge state="won">Won</StatusBadge>
        <StatusBadge state="outbid">Outbid</StatusBadge>
        <StatusBadge state="closing" emphasis>Closing 0:14</StatusBadge>
      </Section>

      <Section title="Category tags">
        <CategoryTag>GC</CategoryTag>
        <CategoryTag>Sprinter</CategoryTag>
        <CategoryTag>Climber</CategoryTag>
        <CategoryTag dense>Domestique</CategoryTag>
      </Section>

      <Section title="Cards">
        <Card className="w-56 p-4">
          <div className="mb-2 font-data text-[11px] uppercase tracking-[.1em] text-cz-3">Team value</div>
          <div className="font-data text-3xl font-semibold tabular-nums text-cz-1">€1.24M</div>
        </Card>
        <Card interactive className="w-56 p-4">
          <div className="flex items-center gap-2">
            <TrophyIcon size={18} className="text-cz-accent" />
            <span className="text-sm font-semibold text-cz-1">Interactive</span>
          </div>
        </Card>
      </Section>

      <Section title="Page primitives (#2849)">
        <div className="w-full space-y-8">
          {/* PageHeader — DEN kanoniske sidehoved-recipe (T1/T2) */}
          <div className="rounded-cz border border-dashed border-cz-border p-4">
            <PageHeader
              title="Transfer market"
              subtitle="412 riders listed · window closes Sunday 18:00"
              actions={
                <>
                  <Select size="sm" defaultValue="all" aria-label="Filter riders">
                    <option value="all">All riders</option>
                    <option value="free">Free agents</option>
                  </Select>
                  <Button size="sm">List rider</Button>
                </>
              }
            />
            <p className="font-data text-[11px] uppercase tracking-[.08em] text-cz-3">
              PageHeader: 20px/700 + 13px subtitle + maks 1 Select sm og 1 primary sm
            </p>
          </div>

          {/* Section/SectionHeader — den ENE card-recipe, sibling-gap 14px */}
          <SectionStack>
            <PageSection>
              <SectionHeader
                title="Squad status"
                action={<SectionAction>View squad</SectionAction>}
              />
              <p className="text-sm text-cz-2">Quiet action i højre slot (12px/500 accent-t + chevron 13px).</p>
            </PageSection>
            <PageSection>
              <SectionHeader title="Payroll" meta="Updated 09:14" />
              <p className="text-sm text-cz-2">Uppercase meta-label i højre slot — aldrig sammen med en action.</p>
            </PageSection>
          </SectionStack>

          {/* DataTable — cz-table-recipen med sticky kolonne, zone-tints og mobil-fold */}
          <DataTable
            label="Transfer market demo"
            count="Showing 6 of 412 riders"
            sort="form"
            sortDir="desc"
            onSort={() => {}}
            rowZone={(r) => r.zone}
            rowKey={(r) => r.name}
            columns={[
              {
                key: "name",
                header: "Rider",
                sticky: true,
                sublineIndent: true,
                render: (r) => (
                  <>
                    <JerseyDot color={r.dot} title={r.type} /> {r.name}
                  </>
                ),
                subline: (r) => `${r.nation} · ${r.team}`,
              },
              { key: "age", header: "Age", numeric: true, fold: true },
              { key: "type", header: "Type", fold: true, render: (r) => <CategoryTag>{r.type}</CategoryTag>, foldValue: (r) => r.type },
              { key: "form", header: "Form", numeric: true, sortKey: "form" },
              { key: "value", header: "Value", numeric: true, sortKey: "value" },
              { key: "status", header: "Status", render: (r) => r.pill && <ZonePill tone={r.zone ?? "neutral"}>{r.pill}</ZonePill> },
              { key: "bid", header: "", render: () => <Button variant="secondary" size="sm">Bid</Button> },
            ]}
            rows={[
              { name: "Ineke van Dijk", nation: "NED", team: "Vélo Rosso", dot: "#e8c547", age: 27, type: "GC", form: 84, value: "1,720,000", zone: "success", pill: "New" },
              { name: "Aoife Brennan", nation: "IRL", team: "Free agent", dot: "#a78bfa", age: 23, type: "Climber", form: 78, value: "1,140,000", zone: "success", pill: "New" },
              { name: "Tomas Reyes", nation: "ESP", team: "Team Helios", dot: "#38bdf8", age: 29, type: "Sprinter", form: 71, value: "960,000", zone: null, pill: null },
              { name: "Émile Rousseau", nation: "FRA", team: "Granfondo Racing", dot: "#34d399", age: 26, type: "Puncheur", form: 66, value: "830,000", zone: null, pill: null },
              { name: "Květa Horák", nation: "CZE", team: "Granfondo Racing", dot: "#a78bfa", age: 31, type: "Climber", form: 58, value: "640,000", zone: "danger", pill: "Closing" },
              { name: "Magnus Lie", nation: "NOR", team: "Free agent", dot: "#f472b6", age: 33, type: "Rouleur", form: 52, value: "410,000", zone: "danger", pill: "Closing" },
            ]}
          />

          {/* Canonical states — chrome renderer altid, kun body swapper */}
          <div className="grid gap-[14px] sm:grid-cols-3">
            <PageSection>
              <SectionHeader title="Loading" meta="Skeleton" />
              <SkeletonLines />
            </PageSection>
            <PageSection>
              <SectionHeader title="Empty" meta="EmptyState" />
              <EmptyState
                title="No riders yet"
                description="Draft your first rider in the live auction."
                action={<Button size="sm">Open auction</Button>}
              />
            </PageSection>
            <PageSection>
              <SectionHeader title="Error" meta="ErrorState" />
              <ErrorState
                title="Couldn't load the market"
                description="Nothing was lost — your bids are safe."
                action={<Button size="sm" variant="secondary">Try again</Button>}
              />
            </PageSection>
          </div>
        </div>
      </Section>

      <Section title="Icon set">
        <div className="grid w-full grid-cols-6 gap-px overflow-hidden rounded-cz border border-cz-border bg-cz-border sm:grid-cols-8">
          {ICON_ENTRIES.map(([name, Icon]) => (
            <div key={name} className="flex flex-col items-center gap-2 bg-cz-card px-2 py-3">
              <Icon size={20} className="text-cz-2" />
              <span className="font-data text-[9px] uppercase tracking-[.05em] text-cz-3">
                {name.replace(/Icon$/, "")}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Form fields">
        <Field label="Team name" htmlFor="ks-name" helper="Shown on the standings." className="w-64">
          <Input id="ks-name" placeholder="E2E Racing" />
        </Field>
        <Field label="Strategy" htmlFor="ks-strat" className="w-64">
          <Select id="ks-strat" defaultValue="gc">
            <option value="gc">General classification</option>
            <option value="sprint">Sprint</option>
            <option value="break">Breakaway</option>
          </Select>
        </Field>
        <Field label="Budget" htmlFor="ks-budget" error="Exceeds remaining balance." className="w-64">
          <Input id="ks-budget" defaultValue="1,400,000" error />
        </Field>
        <Field label="Note" htmlFor="ks-note" className="w-64">
          <Textarea id="ks-note" rows={3} placeholder="Tactics for the day…" />
        </Field>
      </Section>

      <Section title="Choices">
        <Checkbox id="ks-cap" label="Captain" defaultChecked />
        <Checkbox id="ks-dom" label="Domestique" />
        <Radio id="ks-r1" name="ks-role" label="Leader" defaultChecked />
        <Radio id="ks-r2" name="ks-role" label="Support" />
        <Toggle id="ks-auto" label="Auto-bid" defaultChecked />
        <Toggle id="ks-notify" label="Notifications" />
      </Section>

      <Section title="Table">
        <Table className="w-full">
          <thead>
            <Tr>
              <Th sticky>Rider</Th>
              <Th>Type</Th>
              <Th numeric>Value</Th>
              <Th numeric>Form</Th>
            </Tr>
          </thead>
          <tbody>
            <Tr>
              <Td sticky>
                <span className="inline-flex items-center gap-2">
                  <JerseyDot color="#e8c547" title="Maillot jaune" /> Ada Pedersen
                </span>
              </Td>
              <Td><CategoryTag>GC</CategoryTag></Td>
              <Td numeric>€1.68M</Td>
              <Td numeric>+4</Td>
            </Tr>
            <Tr>
              <Td sticky>
                <span className="inline-flex items-center gap-2">
                  <JerseyDot color="#1a47c0" title="Team kit" /> Bo Nielsen
                </span>
              </Td>
              <Td><CategoryTag>Sprinter</CategoryTag></Td>
              <Td numeric>€0.94M</Td>
              <Td numeric>−1</Td>
            </Tr>
          </tbody>
        </Table>
      </Section>

      <Section title="States">
        <EmptyState
          className="w-72"
          icon={<InboxIcon size={28} />}
          title="No riders yet"
          description="Draft your first rider in the live auction."
          action={<Button size="sm">Open auction</Button>}
        />
        <ErrorState
          className="w-72"
          title="Couldn't load riders"
          description="The request timed out."
          action={<Button size="sm" variant="secondary">Retry</Button>}
        />
        <Card className="w-72 p-4">
          <Skeleton className="mb-3 h-5 w-2/3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-sm text-cz-2">Loading…</span>
        </div>
      </Section>

      <Section title="Dividers & links">
        <div className="w-72">
          <p className="text-sm text-cz-2">
            Read the <Link href="#">tactics guide</Link> before the stage.
          </p>
          <Divider className="my-4" />
          <Divider label="or" />
        </div>
      </Section>

      <Section title="Chip (marketing)">
        <Chip>Open beta · Free to play</Chip>
        <Chip icon={<TrophyIcon size={13} className="text-cz-2" />}>Season 1 · Live</Chip>
      </Section>

      <Section title="Avatar">
        <Avatar name="Ada Pedersen" size="sm" />
        <Avatar name="Bo Nielsen" />
        <Avatar name="Casper Vingegaard" size="lg" />
      </Section>

      <Section title="Progress">
        <div className="w-72 space-y-4">
          <ProgressMeter label="Season form" value={72} showValue />
          <ProgressMeter label="Cap used" tone="danger" value={94} showValue />
          <ProgressMeter value={40} ariaLabel="Stage completion" />
        </div>
      </Section>

      <Section title="Tabs">
        <div className="w-full">
          <Tabs value={tab} onChange={setTab}>
            <TabList label="Team views">
              <Tab value="roster">Roster</Tab>
              <Tab value="tactics">Tactics</Tab>
              <Tab value="finance">Finance</Tab>
            </TabList>
            <TabPanel value="roster"><p className="pt-4 text-sm text-cz-2">Roster panel</p></TabPanel>
            <TabPanel value="tactics"><p className="pt-4 text-sm text-cz-2">Tactics panel</p></TabPanel>
            <TabPanel value="finance"><p className="pt-4 text-sm text-cz-2">Finance panel</p></TabPanel>
          </Tabs>
        </div>
      </Section>

      <Section title="Tooltip">
        <div className="pt-8">
          <Tooltip label="Watch this rider" open>
            <Button variant="secondary" size="sm">Hover me</Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Toast">
        <Toast
          className="w-72"
          tone="danger"
          title="You've been outbid"
          description="Ada Pedersen, new price €1.72M"
          onClose={() => {}}
        />
        <Toast
          className="w-72"
          tone="success"
          title="Bid placed"
          description="You lead the auction."
          onClose={() => {}}
        />
      </Section>

      <Section title="Dialog">
        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>Open dialog</Button>
        <DialogSurface
          size="sm"
          title="Release rider?"
          titleId="ks-dialog-preview"
          description="This frees up cap space but cannot be undone this stage."
          onClose={() => {}}
          footer={
            <>
              <Button variant="ghost" size="sm">Cancel</Button>
              <Button variant="danger" size="sm">Release</Button>
            </>
          }
        >
          <p className="text-sm text-cz-2">Ada Pedersen will return to the free-agent pool.</p>
        </DialogSurface>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Release rider?"
          description="This frees up cap space but cannot be undone this stage."
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => setModalOpen(false)}>Release</Button>
            </>
          }
        >
          <p className="text-sm text-cz-2">Ada Pedersen will return to the free-agent pool.</p>
        </Modal>
      </Section>

      <Section title="Dropdown menu">
        <Dropdown
          defaultOpen
          trigger={({ open, toggle }) => (
            <Button variant="secondary" size="sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
              Customize
            </Button>
          )}
        >
          <MenuItem>Show team value</MenuItem>
          <MenuItem active>Show form</MenuItem>
          <MenuItem danger>Reset layout</MenuItem>
        </Dropdown>
      </Section>

      {BOOM_ENABLED && boomRequested() && (
        <Section title="Error boundary (dev/e2e)">
          <Button variant="danger" size="sm" onClick={() => setBoom(true)}>
            Trigger render error
          </Button>
          {boom && <Boom />}
        </Section>
      )}
    </main>
  );
}
