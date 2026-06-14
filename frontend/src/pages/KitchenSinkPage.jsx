import { Button, StatusBadge, CategoryTag, Card, SearchIcon, ChevronRightIcon, TrophyIcon } from "../components/ui/index.js";

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
    </main>
  );
}
