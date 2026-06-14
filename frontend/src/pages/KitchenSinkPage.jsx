import { useState } from "react";
import {
  Button, StatusBadge, CategoryTag, Card,
  Field, Input, Textarea, Select, Checkbox, Radio, Toggle,
  Table, Tr, Th, Td, JerseyDot,
  EmptyState, ErrorState, Skeleton, Spinner, Divider, Link,
  Modal, DialogSurface, Dropdown, MenuItem, Tooltip, Toast,
  Tabs, TabList, Tab, TabPanel,
  SearchIcon, ChevronRightIcon, TrophyIcon, InboxIcon,
} from "../components/ui/index.js";

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

      <Section title="Icons">
        <SearchIcon className="text-cz-2" />
        <ChevronRightIcon className="text-cz-2" />
        <TrophyIcon className="text-cz-accent" />
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
    </main>
  );
}
