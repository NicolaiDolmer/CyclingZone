import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase";
import { Tabs, TabList, Tab, TabPanel, PageLoader } from "../components/ui";
import GrowthOverviewTab from "../components/admin/growth/GrowthOverviewTab";
import GrowthCustomersTab from "../components/admin/growth/GrowthCustomersTab";
import GrowthNpsTab from "../components/admin/growth/GrowthNpsTab";
import { AttributionContent } from "./AdminAttributionPage";
import { WaitlistContent } from "./AdminWaitlistPage";
import { SprintMetricsContent } from "./AdminSprintMetricsPage";
import { RetentionContent } from "./AdminRetentionPage";

// Samlet admin-vækst-dashboard (#3196, ejer-direktiv 31/7 #feedback-from-dolmer,
// subsumerer #2089). Ejerens ordrette krav (se GitHub-issuet): "waitlist,
// sprint metrics, attribution og retention kommer til at blive samlet i samme
// områder, hvor jeg også kan se livstidsværdi på kunderne ... grafer over
// antallet af daglige/ugentlige/månedlige brugere ... d1/d7/d30 ... i større
// perioder end kun en uge ... NPS skal også ind i det område."
//
// Konsoliderer FIRE tidligere standalone /admin/*-sider (waitlist, sprint-
// metrics, attribution, retention) til faner i ÉN flade — deres indholds-
// logik er UDTRUKKET (ikke duplikeret) til navngivne exports i de oprindelige
// filer (AdminWaitlistPage.jsx osv.), som stadig ejer deres egen data-
// hentning/state. De gamle ruter redirecter hertil (se App.jsx) så ingen
// bogmærker/links knækker.
const GROWTH_TABS = ["overview", "customers", "nps", "attribution", "waitlist", "sprint", "retention"];

export default function AdminGrowthPage() {
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = GROWTH_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const setTab = (tab) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    }, { replace: true });

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  if (adminStatus === "checking") {
    return <PageLoader label="Tjekker adgang" minHeight="40vh" />;
  }
  if (adminStatus === "not_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      <div>
        <h1 className="text-cz-1 text-xl font-bold">Vækst-dashboard</h1>
        <p className="text-cz-3 text-sm mt-1">
          DAU/WAU/MAU, retention, abonnementer/LTV, attribution, waitlist, sprint-metrics og NPS samlet ét sted. Refs #3196.
        </p>
      </div>

      <Tabs value={activeTab} onChange={setTab}>
        <TabList label="Vækst-dashboard" className="mb-4">
          <Tab value="overview">Oversigt</Tab>
          <Tab value="customers">Kunder &amp; LTV</Tab>
          <Tab value="nps">NPS</Tab>
          <Tab value="attribution">Attribution</Tab>
          <Tab value="waitlist">Waitlist</Tab>
          <Tab value="sprint">Sprint-metrics</Tab>
          <Tab value="retention">Retention</Tab>
        </TabList>

        <TabPanel value="overview"><GrowthOverviewTab /></TabPanel>
        <TabPanel value="customers"><GrowthCustomersTab /></TabPanel>
        <TabPanel value="nps"><GrowthNpsTab /></TabPanel>
        <TabPanel value="attribution"><AttributionContent /></TabPanel>
        <TabPanel value="waitlist"><WaitlistContent /></TabPanel>
        <TabPanel value="sprint"><SprintMetricsContent /></TabPanel>
        <TabPanel value="retention"><RetentionContent /></TabPanel>
      </Tabs>
    </div>
  );
}
