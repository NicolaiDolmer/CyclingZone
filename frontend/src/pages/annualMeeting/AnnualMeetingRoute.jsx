import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PageLoader } from "../../components/ui";
import { fetchBoardMeeting, fetchBoardRoom } from "./meetingApi";
import AnnualMeetingPage from "./AnnualMeetingPage";

// #4557 (S-M2c) · Rute-vagt for /board/meeting (spec §4.7): adgang KUN naar
// GET /board/meeting svarer { available: true }, ellers redirect til /board
// (kill-switch/legacy-sikker fallback, samme moenster som BoardroomRoute).
export default function AnnualMeetingRoute() {
  const { t } = useTranslation("board");
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "unavailable"
  const [meeting, setMeeting] = useState(null);
  const [confidenceValue, setConfidenceValue] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [meetingData, roomData] = await Promise.all([
        fetchBoardMeeting(),
        fetchBoardRoom(),
      ]);
      if (cancelled) return;
      if (meetingData?.available && meetingData.mandate) {
        setMeeting(meetingData);
        setConfidenceValue(roomData?.confidence?.value ?? null);
        setStatus("ready");
      } else {
        setStatus("unavailable");
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (status === "loading") return <PageLoader label={t("boardroom.meeting.route.loading")} />;
  if (status === "unavailable") return <Navigate to="/board" replace />;
  return <AnnualMeetingPage initialMeeting={meeting} confidenceValue={confidenceValue} />;
}
