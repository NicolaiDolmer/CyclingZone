import { Link } from "react-router-dom";
import { useConsent } from "../lib/consent.jsx";

export default function PrivacyPolicyPage() {
  const { openBanner, consent } = useConsent();

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-cz-card rounded-2xl shadow-lg p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-cz-1 font-bold text-2xl">Privatlivspolitik</h1>
          <Link to="/" className="text-cz-3 hover:text-cz-1 text-sm">← Tilbage</Link>
        </div>

        <p className="text-cz-3 text-sm mb-6">
          Senest opdateret: 11. maj 2026. Cycling Zone er et hobby-projekt drevet som åben beta.
          Vi behandler så lidt data som muligt, og du bestemmer selv hvad vi må måle.
        </p>

        <Section title="Hvem er ansvarlig?">
          Cycling Zone drives privat af spillets udvikler. Henvendelser om dine data kan sendes via Discord (foretrukket) eller via en e-mail oplyst på{" "}
          <Link to="/help" className="text-cz-accent-t underline">Hjælp-siden</Link>. Vi svarer som regel inden for få dage.
        </Section>

        <Section title="Hvilke data behandler vi?">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Konto:</strong> e-mail, brugernavn, valgt holdnavn og manager-navn — nødvendigt for at logge ind og deltage.</li>
            <li><strong>Spildata:</strong> dit holds økonomi, ryttere, auktioner, bestyrelses-status, sæsonresultater — alt skabt ved at spille.</li>
            <li><strong>Frivilligt:</strong> Discord-ID hvis du selv tilføjer det for at modtage DM-notifikationer.</li>
            <li><strong>Teknisk:</strong> IP-adresse i adgangslogs i op til 30 dage til drift og sikkerhed.</li>
            <li><strong>Analyse (kun med dit samtykke):</strong> anonyme adfærdsdata via Microsoft Clarity — fx hvor brugere klikker forgæves eller skroller frustreret. Bruges udelukkende til at rette dårlig UX.</li>
          </ul>
        </Section>

        <Section title="Hvor opbevares dine data?">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase (EU, Frankfurt):</strong> primær database og login.</li>
            <li><strong>Vercel:</strong> hosting af frontend (kan rute via EU/US edge).</li>
            <li><strong>Railway:</strong> hosting af backend.</li>
            <li><strong>Microsoft Clarity:</strong> kun hvis du har accepteret &quot;Analyse&quot;-kategorien.</li>
            <li><strong>Discord (via Discord Inc.):</strong> kun hvis du tilføjer dit Discord-ID frivilligt.</li>
          </ul>
        </Section>

        <Section title="Hvor længe gemmer vi data?">
          Dine konto- og spildata gemmes så længe din konto er aktiv. Sletter du din konto, fjernes personhenførbare data inden for 30 dage; aggregeret spillehistorik (fx tidligere sæsonresultater) kan bevares anonymiseret. Adgangslogs ryger automatisk efter 30 dage.
        </Section>

        <Section title="Dine rettigheder under GDPR">
          Du har ret til at få indsigt i, rettet, slettet, eksporteret eller begrænset behandling af dine data. Du kan til enhver tid trække samtykke til Analyse, Marketing eller E-mail tilbage — det stopper indsamlingen fremover (data hentet før tilbagetrækningen kan ikke fjernes fra anonyme aggregater).
          <div className="mt-3">
            <button
              type="button"
              onClick={openBanner}
              className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90"
            >
              Skift mine samtykke-valg
            </button>
          </div>
          <p className="mt-3 text-cz-3 text-sm">
            Du kan klage til <a href="https://www.datatilsynet.dk" target="_blank" rel="noopener noreferrer" className="text-cz-accent-t underline">Datatilsynet</a> hvis du mener vi behandler dine data ulovligt.
          </p>
        </Section>

        <Section title="Cookies og lokal lagring">
          Vi bruger <em>nødvendige</em> cookies/localStorage til login-session, dit valg af tema (lys/mørk) og dit samtykke-valg. Disse kræver ikke samtykke. Microsoft Clarity bruger first-party-lagring og indlæses kun hvis du har accepteret &quot;Analyse&quot;-kategorien.
        </Section>

        <Section title="Dit nuværende valg">
          <ul className="text-cz-3 text-sm space-y-1">
            <li>Nødvendige: <strong className="text-cz-1">altid på</strong></li>
            <li>Analyse: <strong className="text-cz-1">{consent.analytics ? "accepteret" : "afvist"}</strong></li>
            <li>Marketing: <strong className="text-cz-1">{consent.marketing ? "accepteret" : "afvist"}</strong></li>
            <li>E-mail: <strong className="text-cz-1">{consent.email_marketing ? "accepteret" : "afvist"}</strong></li>
            {consent.updated_at && <li className="text-xs">Sidst opdateret: {new Date(consent.updated_at).toLocaleString("da-DK")}</li>}
          </ul>
        </Section>

        <Section title="Ændringer i politikken">
          Vi opdaterer politikken når nye værktøjer eller funktioner introduceres. Større ændringer annonceres i patch-noter; du kan altid se den nyeste version her.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="text-cz-1 font-semibold text-base mb-2">{title}</h2>
      <div className="text-cz-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
