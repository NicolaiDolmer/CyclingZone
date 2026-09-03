import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader, ToastViewport } from "../../components/ui";
import { resolveApiError } from "../../lib/apiError";
import MandateGoalRow from "./MandateGoalRow";
import VisionSlotSection from "./VisionSlotSection";
import RequestSection from "./RequestSection";
import { postBoardMeetingFocus, postBoardMeetingSign } from "./meetingApi";
import { daysUntil } from "./meetingFormat";
import { logEvent } from "../../lib/logEvent";

const FOCUS_OPTIONS = ["balanced", "youth_development", "star_signing"];
const STEP_KEYS = ["focus", "mandate", "request", "sign"];

function costFor(choice) {
  return choice === "keep" || !choice ? 0 : 1;
}

function defaultChoices(goals) {
  return Object.fromEntries((goals || []).map((g) => [g.goalKey, "keep"]));
}

// #4557 (S-M2c) · Aarsmoedet — fuldskaerms-takeover (spec §4.7, mockup
// AnnualMeeting.dc.html). Hele forhandlingen paa ét scroll (fold-disciplinen
// for T1-sider gaelder ikke denne fullscreen-undtagelse, samme familie som
// SetupWizardModal den erstatter): fokus, mandat, evt. vision-slot,
// anmodning, underskrift. Hurtigste vej er "Sign mandate" med alt paa Keep —
// to klik i alt fra Boardroom.
export default function AnnualMeetingPage({ initialMeeting, confidenceValue }) {
  const { t } = useTranslation("board");
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState(initialMeeting);
  const [choices, setChoices] = useState(() => defaultChoices(initialMeeting?.mandate?.goals));
  const [requestType, setRequestType] = useState(null);
  const [visionChoice, setVisionChoice] = useState(null); // null | true | false
  const [changingFocus, setChangingFocus] = useState(false);
  const [signing, setSigning] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);

  const mandate = meeting?.mandate;
  const goals = mandate?.goals || [];
  const allowed = mandate?.adjustments?.allowed ?? 0;
  const usedCount = useMemo(
    () => Object.values(choices).reduce((sum, c) => sum + costFor(c), 0),
    [choices],
  );
  const remaining = Math.max(0, allowed - usedCount);
  const days = daysUntil(mandate?.deadlineAt);

  // #4557 (S-M2d) · instrumentering (#1141: mødegennemførelse) — canary for
  // "aabnede aarsmoedet". Fyrer kun én gang pr. mount, ikke pr. re-render fra
  // focus-skift (mandate.id skifter DÉR, saa listen er bevidst tom — ikke
  // [mandate?.id]). Fire-and-forget, samme mønster som al øvrig logEvent-brug.
  useEffect(() => {
    if (mandate) logEvent("feature_board_meeting_opened", { goalCount: goals.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kun ved mount, se kommentar
  }, []);

  function pushToast(tone, title) {
    toastSeq.current += 1;
    setToasts((prev) => [...prev, { id: `meeting-toast-${toastSeq.current}`, tone, title }]);
  }
  function dismissToast(id) {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  function handleChoose(goalKey, newChoice) {
    setChoices((prev) => {
      const current = prev[goalKey] || "keep";
      if (current === newChoice) return prev;
      const goal = goals.find((g) => g.goalKey === goalKey);
      const option = goal?.options?.[newChoice];
      if (newChoice !== "keep" && !option) return prev; // #3012-klassen: intet dødt klik gennemfører en no-op
      const currentUsed = Object.values(prev).reduce((sum, c) => sum + costFor(c), 0);
      const newUsed = currentUsed - costFor(current) + costFor(newChoice);
      if (newUsed > allowed) return prev;
      return { ...prev, [goalKey]: newChoice };
    });
  }

  async function handleFocusChange(nextFocus) {
    if (!mandate || nextFocus === mandate.focus || changingFocus) return;
    setChangingFocus(true);
    const { ok, data } = await postBoardMeetingFocus(nextFocus);
    setChangingFocus(false);
    if (ok && data?.available) {
      setMeeting(data);
      setChoices(defaultChoices(data.mandate?.goals));
      setRequestType(null);
    } else {
      pushToast("danger", resolveApiError(data, t, t("boardroom.meeting.sign.focusChangeError")));
    }
  }

  async function handleSign() {
    if (!mandate || signing) return;
    setSigning(true);
    const adjustments = Object.entries(choices)
      .filter(([, choice]) => choice !== "keep")
      .map(([goalKey, choice]) => ({ goalKey, choice }));
    const payload = {
      mandateId: mandate.id,
      adjustments,
      request: requestType ? { type: requestType } : null,
      visionSlot: visionChoice === null ? null : { accept: visionChoice },
    };
    const { ok, data } = await postBoardMeetingSign(payload);
    if (ok) {
      // #4557 (S-M2d) · instrumentering (#1141: mødegennemførelse) — canary
      // for "gennemførte aarsmoedet" (funnel-modstykke til
      // feature_board_meeting_opened ovenfor).
      logEvent("board_meeting_signed", {
        adjustmentsUsed: adjustments.length,
        hasRequest: Boolean(requestType),
        visionSlotAnswered: visionChoice !== null,
      });
      navigate("/board", { replace: true });
      return;
    }
    setSigning(false);
    pushToast("danger", resolveApiError(data, t, t("boardroom.meeting.sign.error")));
  }

  if (!mandate) return null;

  return (
    <main className="min-h-screen bg-cz-body pb-16">
      <div className="bg-cz-sidebar py-[22px]">
        <div className="mx-auto flex max-w-[896px] flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-[34px] leading-[0.92] tracking-[.02em] text-cz-sidebar-1">
              {t("boardroom.meeting.header.title", { season: mandate.seasonNumber }).toUpperCase()}
            </h1>
            <div className="mt-1.5 text-[13px] text-cz-sidebar-2">{t("boardroom.meeting.header.subtitle")}</div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-2xs uppercase tracking-[.08em] text-cz-sidebar-2">
              {confidenceValue != null
                ? t("boardroom.meeting.header.confidenceMeta", { confidence: confidenceValue, count: remaining })
                : t("boardroom.meeting.header.confidenceMetaNoValue", { count: remaining })}
            </div>
            {days != null && (
              <div className="mt-1 font-data text-2xs tabular-nums text-cz-sidebar-3">
                {t("boardroom.meeting.header.deadline", { days })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-5 flex max-w-[896px] items-center gap-2 px-4 text-xs">
        {STEP_KEYS.map((key, i) => (
          <span key={key} className="flex items-center gap-2">
            {i > 0 && <span className="text-cz-border">/</span>}
            <span className={key === "mandate" ? "border-b-2 border-cz-accent pb-0.5 font-semibold text-cz-1" : "text-cz-3"}>
              {i + 1} {t(`boardroom.meeting.steps.${key}`)}
            </span>
          </span>
        ))}
      </div>

      <div className="mx-auto mt-4 flex max-w-[896px] flex-col gap-[14px] px-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">
            {t("boardroom.meeting.focus.label")}
          </span>
          <div className="flex flex-wrap gap-[6px]">
            {FOCUS_OPTIONS.map((focusKey) => (
              <button
                key={focusKey}
                type="button"
                disabled={changingFocus}
                onClick={() => handleFocusChange(focusKey)}
                className={`rounded-cz-pill border px-3 py-[5px] text-xs font-medium transition-colors duration-150 disabled:opacity-60 ${
                  mandate.focus === focusKey
                    ? "border-cz-sidebar bg-cz-sidebar font-semibold text-cz-sidebar-1"
                    : "border-cz-border bg-cz-card text-cz-2 hover:border-cz-3"
                }`}
              >
                {t(`focus.${focusKey}`)}
              </button>
            ))}
          </div>
        </div>

        <Section>
          <SectionHeader
            title={t("boardroom.meeting.mandate.title", { focus: t(`focus.${mandate.focus}`) })}
            meta={t("boardroom.meeting.mandate.meta", { count: goals.length, used: usedCount, allowed })}
          />
          <div>
            {goals.map((goal) => {
              const choice = choices[goal.goalKey] || "keep";
              const wouldExceedBudget = usedCount - costFor(choice) + 1 > allowed;
              return (
                <MandateGoalRow
                  key={goal.goalKey}
                  goal={goal}
                  choice={choice}
                  onChoose={(next) => handleChoose(goal.goalKey, next)}
                  wouldExceedBudget={wouldExceedBudget}
                />
              );
            })}
          </div>
        </Section>

        <VisionSlotSection visionSlot={meeting.visionSlot} choice={visionChoice} onChoose={setVisionChoice} />

        <RequestSection
          options={meeting.request?.options || []}
          selectedType={requestType}
          onSelect={setRequestType}
          onClear={() => setRequestType(null)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 py-1">
          <p className="text-xs text-cz-3">{t("boardroom.meeting.sign.hint")}</p>
          <div className="flex gap-[10px]">
            <button
              type="button"
              onClick={() => navigate("/board")}
              className="rounded-cz border border-cz-border bg-cz-card px-3.5 py-[9px] text-[13px] font-medium text-cz-2 transition-colors duration-150 hover:border-cz-3"
            >
              {t("boardroom.meeting.sign.back")}
            </button>
            <button
              type="button"
              disabled={signing}
              onClick={handleSign}
              className="rounded-cz bg-cz-accent px-4 py-[9px] text-[13px] font-semibold text-cz-on-accent transition-colors duration-150 hover:brightness-105 disabled:opacity-60"
            >
              {signing ? t("boardroom.meeting.sign.signing") : t("boardroom.meeting.sign.button")}
            </button>
          </div>
        </div>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
