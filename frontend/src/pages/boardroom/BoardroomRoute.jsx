import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { PageLoader } from "../../components/ui";
import BoardroomPage from "./BoardroomPage";

const API = import.meta.env.VITE_API_URL;

// #4557 (S-M2b) · Tynd flag-wrapper for /board (App.jsx). ÉT let kald til
// GET /api/board/room afgør retningen:
//   enabled: true  → BoardroomPage, fodret med den payload wrapperen ALLEREDE
//                     har hentet (ingen dobbelt-fetch af /api/board/room).
//   enabled: false / fejl / netvaerksfejl → den eksisterende BoardPage
//                     uaendret (kill-switch = sikker fallback til legacy,
//                     ikke en fejlflade — BoardPage laver derefter sit eget
//                     normale /api/board/status-kald, som den altid har gjort).
// `LegacyBoardPage` gives ind som prop fra App.jsx's eksisterende lazy-import,
// saa BoardPage kun defineres ét sted (ingen duplikeret lazy-split).
export default function BoardroomRoute({ LegacyBoardPage }) {
  const { t } = useTranslation("board");
  const [status, setStatus] = useState("loading"); // "loading" | "boardroom" | "legacy"
  const [roomData, setRoomData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFlag() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { if (!cancelled) setStatus("legacy"); return; }

      let res;
      try {
        res = await fetch(`${API}/api/board/room`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        console.error("Boardroom flag check failed:", e);
        if (!cancelled) setStatus("legacy");
        return;
      }

      if (!res.ok) { if (!cancelled) setStatus("legacy"); return; }

      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (data?.enabled) {
        setRoomData(data);
        setStatus("boardroom");
      } else {
        setStatus("legacy");
      }
    }

    loadFlag();
    return () => { cancelled = true; };
  }, []);

  if (status === "loading") return <PageLoader label={t("boardroom.route.loading")} />;
  if (status === "boardroom") return <BoardroomPage data={roomData} />;
  return <LegacyBoardPage />;
}
