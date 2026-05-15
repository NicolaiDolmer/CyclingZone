import { Link } from "react-router-dom";
import { useConsent } from "../lib/consent.jsx";

export default function PrivacyPolicyPage() {
  const { openBanner, consent } = useConsent();

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-cz-card rounded-2xl shadow-lg p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-cz-1 font-bold text-2xl">Privatlivspolitik</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/privacy-policy" className="text-cz-3 hover:text-cz-1">English</Link>
            <Link to="/" className="text-cz-3 hover:text-cz-1">← Tilbage</Link>
          </div>
        </div>

        <p className="text-cz-3 text-sm mb-6">
          Senest opdateret: 15. maj 2026. Cycling Zone er en åben beta drevet som enkeltmandsvirksomhed.
          Vi behandler så lidt data som muligt, og du bestemmer selv hvad vi må måle.
        </p>

        <Section title="Hvem er dataansvarlig?">
          <p>
            <strong>Cycling Zone v/ Nicolai Dolmer Mikkelsen</strong> (enkeltmandsvirksomhed under registrering, CVR følger primo juni 2026).
          </p>
          <p className="mt-2">
            Henvendelser om dine data — indsigt, sletning, dataportabilitet, indsigelse — kan sendes via Discord (foretrukket) eller via en e-mail oplyst på{" "}
            <Link to="/help" className="text-cz-accent-t underline">Hjælp-siden</Link>. Vi svarer normalt inden for få dage, senest inden for én måned jf. GDPR art. 12.
          </p>
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

        <Section title="Founder Supporter-waitlist (uforpligtende interessetilkendegivelse)">
          <p className="mb-2">
            Hvis du tilmelder dig vores waitlist for &quot;Founder Supporter&quot;-status, behandler vi følgende data baseret på dit udtrykkelige samtykke (GDPR art. 6, stk. 1, litra a):
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Kontakt:</strong> e-mail og/eller Discord-handle (mindst én kræves så vi kan vende tilbage).</li>
            <li><strong>Intent:</strong> interesseniveau, foretrukken tier, primær årsag, hvilke fordele du værdsætter, hvad du opfatter som unfair (fritekst).</li>
            <li><strong>Opfølgning:</strong> samtykke til personlig opfølgning (separat ja/nej).</li>
            <li><strong>Attribution:</strong> hvor du kom fra (UTM-parameter eller manuelt tag — fx &quot;discord_launch&quot;).</li>
            <li><strong>Tidspunkt:</strong> hvornår du gav samtykke (tidsstempel som bevis).</li>
          </ul>
          <p className="mt-3">
            <strong>Formål:</strong> at administrere waitlisten, kontakte dig vedrørende lancering, og måle hvilke kanaler der genererer reel interesse.
          </p>
          <p className="mt-2">
            <strong>Opbevaring:</strong> indtil du beder os slette dig, eller efter 24 måneders inaktivitet — hvad der kommer først. Du kan til enhver tid skrive til os og blive slettet.
          </p>
          <p className="mt-2">
            <strong>Vigtigt:</strong> en waitlist-tilmelding er <em>ikke</em> et køb og <em>ikke</em> bindende. Der opkræves ingen betaling før en eventuel senere lancering, hvor du aktivt skal acceptere salgsvilkår.
          </p>
        </Section>

        <Section title="Tredjeparter (databehandlere)">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase (EU, Frankfurt):</strong> database og autentificering — databehandleraftale i kraft.</li>
            <li><strong>Vercel:</strong> hosting af frontend (EU/US edge). Vercel kan se IP i adgangslogs.</li>
            <li><strong>Railway:</strong> hosting af backend.</li>
            <li><strong>Microsoft Clarity:</strong> kun aktiveret hvis du har accepteret &quot;Analyse&quot;-kategorien.</li>
            <li><strong>Discord (via Discord Inc.):</strong> kun hvis du frivilligt tilføjer dit Discord-ID, eller skriver til os på Discord. Discord er en selvstændig dataansvarlig for det indhold du sender til os der.</li>
          </ul>
          <p className="mt-2 text-cz-3 text-xs">
            Vi sælger eller deler ikke dine data med tredjeparter til marketing. Et link til Discord er ikke en data-overførsel — først når du selv klikker og skriver til os.
          </p>
        </Section>

        <Section title="Hvor længe gemmer vi data?">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Konto- og spildata:</strong> så længe din konto er aktiv. Sletter du kontoen, fjernes personhenførbare data inden for 30 dage; aggregeret spillehistorik (fx tidligere sæsonresultater) kan bevares anonymiseret.</li>
            <li><strong>Waitlist-data:</strong> indtil du beder os slette dig, eller 24 måneders inaktivitet — hvad der kommer først.</li>
            <li><strong>Adgangslogs (IP):</strong> automatisk slettet efter 30 dage.</li>
            <li><strong>Samtykke-bevis (consent_given_at + valg):</strong> så længe det relaterede data behandles, så vi kan dokumentere lovligt grundlag.</li>
          </ul>
        </Section>

        <Section title="Dine rettigheder under GDPR">
          Du har ret til:
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Indsigt</strong> — at få at vide hvilke data vi har om dig.</li>
            <li><strong>Berigtigelse</strong> — at få forkerte data rettet.</li>
            <li><strong>Sletning</strong> (&quot;ret til at blive glemt&quot;).</li>
            <li><strong>Dataportabilitet</strong> — at få dine data udleveret i et maskinlæsbart format.</li>
            <li><strong>Indsigelse</strong> mod behandling baseret på legitim interesse.</li>
            <li><strong>Tilbagetrækning af samtykke</strong> — gælder fremadrettet og stopper indsamlingen. Data hentet før tilbagetrækningen kan ikke fjernes fra anonyme aggregater.</li>
            <li><strong>Klage til Datatilsynet</strong> — <a href="https://www.datatilsynet.dk" target="_blank" rel="noopener noreferrer" className="text-cz-accent-t underline">datatilsynet.dk</a>.</li>
          </ul>
          <div className="mt-3">
            <button
              type="button"
              onClick={openBanner}
              className="bg-cz-accent-t text-white font-semibold text-sm rounded-lg px-4 py-2 hover:opacity-90"
            >
              Skift mine samtykke-valg
            </button>
          </div>
        </Section>

        <Section title="Cookies og lokal lagring">
          <p>
            Vi bruger <em>nødvendige</em> cookies/localStorage og first-party-lagring til:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Login-session</strong> (Supabase auth) — nødvendig for at holde dig logget ind.</li>
            <li><strong>Temavalg</strong> (lys/mørk) — gemt lokalt i din browser.</li>
            <li><strong>Samtykke-valg</strong> (<code className="text-xs">cz_consent_v1</code> i localStorage) — så vi husker dine valg og ikke spørger igen.</li>
          </ul>
          <p className="mt-2">
            Disse kræver ikke samtykke jf. ePrivacy-direktivet (strengt nødvendige). <strong>Microsoft Clarity</strong> indlæses kun hvis du aktivt har accepteret &quot;Analyse&quot;-kategorien — du kan til enhver tid skifte valg her på siden.
          </p>
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
