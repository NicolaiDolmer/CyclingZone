import { useNavigate, useParams } from "react-router-dom";
import SeasonFinanceReportPanel from "../components/SeasonFinanceReportPanel";

// Slice 07h · Sæson-finansrapport per hold — RUTE-shell.
//
// Body + fetch lever i SeasonFinanceReportPanel (#986: samme panel genbruges i
// /finance Historik-fanen). Denne rute bevares for admin cross-team-visning og
// dyb-links; ejer-vendte indgange peger nu på Historik-fanen i stedet.
export default function SeasonFinanceReport() {
  const { seasonId, teamId } = useParams();
  const navigate = useNavigate();
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <SeasonFinanceReportPanel
        seasonId={seasonId}
        teamId={teamId}
        onBack={() => navigate(-1)}
      />
    </div>
  );
}
