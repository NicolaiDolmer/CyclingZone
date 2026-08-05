import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { supabase } from "../lib/supabase";
import { Button, Card, Chip, EmptyState, ErrorState, PageLoader, SkeletonLines, Textarea } from "../components/ui";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth";

// #3138 — ejerens fair-play review-kø: viser fairplay_flags (det daglige
// scoring-sweeps mistænkte hændelser) med evidens i klar tekst, og lader
// ejeren afvise/eskalere med ét klik + notat. RENT read-only analyse-lag:
// intet her ændrer spil-tilstand — 'Håndteret' er kun bogføring; en evt.
// sanktion er en separat, manuel ejer-handling. dismissed/actioned fredes
// af sweepet (gen-scores aldrig), så dommen står ved magt.
const API = import.meta.env.VITE_API_URL;

const TYPE_LABELS = {
  pair_value_flow: "Ensidig værdistrøm",
  lifecycle_funnel: "Livscyklus-tragt",
};

const SIGNAL_LABELS = {
  ip_exact_low_fanout: "Delt privat IP (fan-out ≤2)",
  ip_prefix_low_fanout: "Delt IP-område",
  first_seen_at_match: "Samme browser-stempel (first_seen-arv)",
  signup_proximity: "Konti oprettet ≤15 min fra hinanden",
  email_username_similarity: "Email-/brugernavns-lighed",
  price_band_outlier: "Pris uden for ærligt bånd (0,10×–2,2×)",
  loan_then_value_loss: "Lån straks fulgt af værditab",
  account_age_at_tx: "Helt ny konto ved handlen",
  low_activity_profile: "Ingen reel spilaktivitet",
  disposable_email: "Engangs-maildomæne",
};

const STATUS_LABELS = { new: "Ny", reviewing: "Under review", dismissed: "Afvist", actioned: "Håndteret" };

const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("da-DK").format(Math.round(n)));
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : "—";

function FlagCard({ flag, onUpdate, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(flag.owner_note ?? "");
  const ev = flag.evidence ?? {};

  const summary =
    flag.flag_type === "pair_value_flow"
      ? `${fmtNum(Math.abs(ev.net_value_flow))} CZ$ netto mod ${ev.net_flow_direction ?? "?"} over ${ev.n_transactions ?? "?"} handler (90 dage)`
      : `${fmtNum(ev.trigger_transaction?.amount)} CZ$ betalt ${ev.trigger_transaction?.from ?? "?"} → ${ev.trigger_transaction?.to ?? "?"}${ev.trigger_transaction?.rider ? ` for ${ev.trigger_transaction.rider}` : ""}`;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-cz-1 text-xl font-bold font-data tabular-nums">{Number(flag.score).toFixed(2)}</span>
        <span className="text-cz-1 font-semibold">
          {flag.team_lo_name} ↔ {flag.team_hi_name}
        </span>
        <Chip>{TYPE_LABELS[flag.flag_type] ?? flag.flag_type}</Chip>
        <Chip>{STATUS_LABELS[flag.status] ?? flag.status}</Chip>
        <span className="text-cz-3 text-xs ms-auto">
          Først set {fmtDate(flag.first_detected_at)} · senest scoret {fmtDate(flag.last_scored_at)}
        </span>
      </div>

      <p className="text-cz-2 text-sm">{summary}</p>

      <div className="flex flex-wrap gap-1.5">
        {(flag.signals ?? []).map((s) => (
          <Chip key={s.name} title={`styrke ${s.strength} × vægt ${s.weight} = bidrag ${s.contribution}`}>
            {SIGNAL_LABELS[s.name] ?? s.name} ({s.contribution})
          </Chip>
        ))}
      </div>

      <button
        type="button"
        className="text-cz-3 text-xs underline underline-offset-2 hover:text-cz-1"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "Skjul evidens" : "Vis evidens"}
      </button>

      {expanded && (
        <div className="space-y-2 text-sm text-cz-2 border-t border-cz-hairline pt-3">
          {flag.flag_type === "pair_value_flow" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-sort-exempt="lille evidens-uddrag (maks 15 rækker), kronologisk rækkefølge ER evidensen">
                <thead>
                  <tr className="text-cz-3 text-left">
                    <th className="pr-3 py-1 font-normal">Tidspunkt</th>
                    <th className="pr-3 py-1 font-normal">Type</th>
                    <th className="pr-3 py-1 font-normal">Fra → Til</th>
                    <th className="pr-3 py-1 font-normal">Rytter</th>
                    <th className="pr-3 py-1 font-normal text-right">Pris</th>
                    <th className="pr-3 py-1 font-normal text-right">Værdi</th>
                    <th className="py-1 font-normal text-right">Ratio</th>
                  </tr>
                </thead>
                <tbody className="font-data tabular-nums">
                  {(ev.transactions ?? []).map((tx, i) => (
                    <tr key={i} className="border-t border-cz-hairline">
                      <td className="pr-3 py-1">{fmtDate(tx.at)}</td>
                      <td className="pr-3 py-1">{tx.type}</td>
                      <td className="pr-3 py-1">{tx.from} → {tx.to}</td>
                      <td className="pr-3 py-1">{tx.rider ?? "—"}</td>
                      <td className="pr-3 py-1 text-right">{fmtNum(tx.price)}</td>
                      <td className="pr-3 py-1 text-right">{fmtNum(tx.rider_value)}</td>
                      <td className="py-1 text-right">{tx.ratio == null ? "—" : `${tx.ratio}×`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {flag.flag_type === "lifecycle_funnel" && ev.trigger_transaction && (
            <p>
              Udløsende handel: {ev.trigger_transaction.type} {fmtDate(ev.trigger_transaction.at)} —{" "}
              {ev.trigger_transaction.from} → {ev.trigger_transaction.to}, {fmtNum(ev.trigger_transaction.amount)} CZ$
              {ev.n_large_transactions > 1 ? ` (${ev.n_large_transactions} store handler i alt mellem parret)` : ""}.
            </p>
          )}
          {ev.components && (
            <p className="text-cz-3 text-xs">
              Komponenter: værdi {ev.components.value} · identitet {ev.components.identity} · prisafvigelse{" "}
              {ev.components.priceOutlier} · livscyklus {ev.components.lifecycle}. Rytterværdier er nutidige (ingen
              historisk snapshot).
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-cz-hairline pt-3">
        <div className="grow min-w-[220px]">
          <Textarea
            rows={1}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ejer-notat (gemmes sammen med din handling)…"
            aria-label="Ejer-notat"
          />
        </div>
        {flag.status !== "reviewing" && (
          <Button variant="secondary" disabled={busy} onClick={() => onUpdate(flag.id, "reviewing", note)}>
            Under review
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => onUpdate(flag.id, "dismissed", note)}>
          Afvis
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onUpdate(flag.id, "actioned", note)}>
          Markér håndteret
        </Button>
      </div>
    </Card>
  );
}

export default function AdminFairplayPage() {
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [scope, setScope] = useState("open"); // open | all
  const [state, setState] = useState({ loading: true, error: null, flags: [], tableMissing: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  const load = useCallback(async (currentScope) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API}/api/admin/fairplay/flags?status=${currentScope === "all" ? "all" : "open"}`, {
        headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      if (!res.ok) throw new Error(adminErrorMessage(data, res));
      setState({ loading: false, error: null, flags: data.flags ?? [], tableMissing: Boolean(data.tableMissing) });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [getAuth]);

  useEffect(() => {
    if (adminStatus === "admin") load(scope);
  }, [adminStatus, scope, load]);

  const updateFlag = useCallback(
    async (id, status, ownerNote) => {
      setBusy(true);
      try {
        const res = await fetch(`${API}/api/admin/fairplay/flags/${id}`, {
          method: "POST",
          headers: await getAuth(),
          body: JSON.stringify({ status, owner_note: ownerNote }),
        });
        const data = await readAdminJson(res);
        if (!res.ok) throw new Error(adminErrorMessage(data, res));
        showMsg(`Flag markeret "${STATUS_LABELS[status] ?? status}"`);
        await load(scope);
      } catch (err) {
        showMsg(err.message, "error");
      } finally {
        setBusy(false);
      }
    },
    [getAuth, load, scope, showMsg]
  );

  if (adminStatus === "checking") {
    return <PageLoader label="Tjekker adgang" minHeight="40vh" />;
  }
  if (adminStatus === "not_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-cz-1 text-xl font-bold">Fair play — review-kø</h1>
          <p className="text-cz-3 text-sm mt-1">
            Mistænkte hændelser fra det daglige scoring-sweep (#3138). Systemet flagger — du afgør. Ingen automatik.
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant={scope === "open" ? "primary" : "secondary"} onClick={() => setScope("open")}>
            Åbne
          </Button>
          <Button variant={scope === "all" ? "primary" : "secondary"} onClick={() => setScope("all")}>
            Alle
          </Button>
          <Button variant="secondary" onClick={() => load(scope)} disabled={state.loading}>
            Opdatér
          </Button>
        </div>
      </div>

      {msg.text && (
        <p className={`text-sm ${msg.type === "error" ? "text-cz-danger" : "text-cz-2"}`} role="status">
          {msg.text}
        </p>
      )}

      {state.loading ? (
        <Card className="p-4"><SkeletonLines lines={4} /></Card>
      ) : state.error ? (
        <ErrorState title="Kunne ikke hente flag" description={state.error} onRetry={() => load(scope)} />
      ) : state.tableMissing ? (
        <EmptyState
          title="Sweepet er ikke aktiveret endnu"
          description="fairplay_flags-tabellen findes ikke — migrationen database/2026-08-06-3138-fairplay-flags.sql skal applies først. Cron'en skipper roligt indtil da."
        />
      ) : state.flags.length === 0 ? (
        <EmptyState
          title={scope === "open" ? "Ingen åbne flag" : "Ingen flag"}
          description="Det daglige sweep har ikke fundet mistænkte hændelser over tærsklen. Tærsklen kan justeres i app_config (fairplay_flag_threshold)."
        />
      ) : (
        <div className="space-y-3">
          {state.flags.map((f) => (
            <FlagCard key={f.id} flag={f} onUpdate={updateFlag} busy={busy} />
          ))}
        </div>
      )}
    </div>
  );
}
