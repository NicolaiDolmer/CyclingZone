// #7947 retning 5: hvor rytterens plan/program kan ses (spiller-oenske 19/11, build-a-feature):
// 1) telefonen, fanen I dag: planen staar i raekken uden at folde ud;
// 2) rytterens egen side, fanen Traening: kortet siger, at en plan styrer, og der er ingen
//    vaelger, som ser ud til at virke. Navne og tal er eksempler.
import { CalendarIcon, ChevronRightIcon, LockIcon, UserIcon } from "../../../components/ui/icons/index.jsx";
import { FatiguePlate } from "./R5Parts.tsx";

const LABEL = "font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";

type Row = { name: string; meta: string; fatigue: number; today: string; effort: string; plan: string; planKind: "program" | "own" | "team" | "quick" };
const ROWS: Row[] = [
  { name: "Arne Deneve", meta: "Climber · 26", fatigue: 34, today: "VO2max", effort: "Hard", plan: "Own plan · day 3 of 7", planKind: "own" },
  { name: "Lukas Moesgaard", meta: "Climber · 23", fatigue: 41, today: "Long climbs", effort: "Medium", plan: "Program: Climbing block · week 2 of 4", planKind: "program" },
  { name: "Owen Pellow", meta: "Sprinter · 21", fatigue: 22, today: "Sprint", effort: "Hard", plan: "Hard today · program continues tomorrow", planKind: "quick" },
  { name: "Jesper Hollund", meta: "Baroudeur · 28", fatigue: 57, today: "Recovery", effort: "Easy", plan: "Team program", planKind: "team" },
];

const EFFORT_TONE: Record<string, string> = { Hard: "text-cz-danger", Medium: "text-cz-warning", Easy: "text-cz-success" };

function PlanLine({ row }: { row: Row }) {
  const icon = row.planKind === "quick"
    ? <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cz-accent" aria-hidden="true" />
    : <CalendarIcon size={11} aria-hidden="true" className="shrink-0 text-cz-3" />;
  return (
    <span className={`mt-0.5 flex min-w-0 items-center gap-1 text-2xs ${row.planKind === "quick" ? "text-cz-accent-t" : "text-cz-2"}`}>
      {icon}<span className="truncate">{row.plan}</span>
    </span>
  );
}

function MobileToday() {
  return (
    <div className="mx-auto w-full max-w-[390px] px-4 py-5">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Today · phone</div>
      <h2 className="font-data text-lg font-bold leading-tight text-cz-1">The plan stands in the row</h2>
      <p className="mt-1 text-xs text-cz-2">One quiet line under the name says what the rider follows. No need to open the row.</p>
      <ul className="mt-3 overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {ROWS.map((r) => (
          <li key={r.name} className="flex items-center gap-3 border-b border-cz-border px-3 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <UserIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="truncate text-sm font-medium text-cz-1">{r.name}</span>
              </div>
              <div className="text-2xs text-cz-3">{r.meta}</div>
              <PlanLine row={r} />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-cz-1">{r.today}</span>
              <span className={`text-2xs font-medium ${EFFORT_TONE[r.effort]}`}>{r.effort}</span>
            </div>
            <FatiguePlate value={r.fatigue} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-2xs text-cz-3">Names and numbers are examples.</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4">
      <h3 className="mb-3 font-data text-base font-semibold text-cz-1">{title}</h3>
      {children}
    </section>
  );
}

function ProfileTraining() {
  return (
    <div className="mx-auto max-w-[920px] px-4 py-6 sm:px-6">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Rider page · Training tab</div>
      <h2 className="font-data text-xl font-bold leading-tight text-cz-1">The rider page says when a plan is in charge</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-cz-2">With a plan or program, the card shows what he follows and today's session. There is no picker here, so nothing looks changeable that isn't. Without a plan, the picker stays as today.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className={`${LABEL} mb-1.5`}>Follows a plan</div>
          <Card title="Training focus">
            <div className="flex items-start gap-2 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2.5">
              <LockIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-cz-1">Follows his own plan</div>
                <div className="text-xs text-cz-2">Day 3 of 7 · set on the training page</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-cz-3">Today</dt><dd className="text-cz-1">VO2max · <span className="text-cz-danger">Hard</span></dd>
              <dt className="text-cz-3">Trains</dt><dd className="text-cz-1">Climbing, Punch, Tempo</dd>
              <dt className="text-cz-3">Tomorrow</dt><dd className="text-cz-1">Endurance · <span className="text-cz-success">Easy</span></dd>
            </dl>
            <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cz-accent-t hover:underline">
              Change it in Program<ChevronRightIcon size={12} aria-hidden="true" />
            </button>
          </Card>
        </div>
        <div>
          <div className={`${LABEL} mb-1.5`}>No plan (as today)</div>
          <Card title="Training focus">
            <div className="flex items-center justify-between rounded-cz border border-cz-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-cz-1">Training</div>
                <div className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">Mixed intervals</div>
              </div>
              <button type="button" className="text-sm font-medium text-cz-accent-t hover:underline">Change</button>
            </div>
            <p className="mt-3 text-xs text-cz-2">No plan: what you pick here is what he trains.</p>
          </Card>
        </div>
      </div>
      <p className="mt-3 text-2xs text-cz-3">Names and numbers are examples.</p>
    </div>
  );
}

export default function PlanVisibility({ which }: { which: "mobile" | "profile" }) {
  return <div id="shot">{which === "mobile" ? <MobileToday /> : <ProfileTraining />}</div>;
}
