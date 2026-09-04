import { Link } from "react-router";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { Wordmark } from "../components/Brand.jsx";
import { Section, SectionHeader, SectionStack } from "../components/ui";
import { ChevronLeftIcon } from "../components/ui/icons/index.jsx";

// #2813: Handelsbetingelser for CZ Pro. DA-udgaven i dual-page-mønsteret
// (samme struktur som PrivacyPolicyPage) — hardkodet dansk copy, EXEMPT i
// i18n-page-untranslated-guarden. Teksten er ejer-godkendt 30/7
// (docs/legal/TERMS_DRAFT_2026-07-30.md v0.2); versionen der logges ved
// accept står i lib/termsVersion.js. Hold TermsPageEn.jsx strukturelt identisk.
export default function TermsPage() {
  useDocumentHead({
    title: "Handelsbetingelser · Cycling Zone",
    description:
      "Handelsbetingelser for CZ Pro: pris, automatisk fornyelse, opsigelse og fortrydelsesret.",
    canonical: "https://cyclingzone.org/handelsbetingelser",
    lang: "da",
  });

  return (
    <div className="min-h-screen bg-cz-body py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <Link to="/" aria-label="Cycling Zone" className="inline-block">
              <Wordmark className="h-4 w-auto mb-3" alt="" />
            </Link>
            <h1 className="text-cz-1 font-display text-4xl tracking-tight leading-none">Handelsbetingelser</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3 text-sm pt-1">
            <Link to="/terms" className="text-cz-3 hover:text-cz-1">English</Link>
            <Link to="/" className="inline-flex items-center gap-1 text-cz-3 hover:text-cz-1">
              <ChevronLeftIcon size={14} aria-hidden="true" />Tilbage
            </Link>
          </div>
        </div>

        <p className="text-cz-3 text-sm mb-6">
          Senest opdateret: 2. september 2026 · Version 2026-09-02. Gælder for køb af CZ Pro-abonnementet i browserspillet Cycling Zone.
        </p>

        <SectionStack>
          <Section>
            <SectionHeader title="1. Hvem sælger" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Cycling Zone drives af <strong>Dolmer Digital</strong> (CVR 46524861), enkeltmandsvirksomhed v/ Nicolai Dolmer Mikkelsen. Det er samme juridiske enhed som i{" "}
                <Link to="/privatlivspolitik" className="text-cz-accent-t underline">privatlivspolitikken</Link>.
              </p>
              <p className="mt-2">
                Kontakt: via Discord-serveren (samme kanal som privatlivspolitikken henviser til) eller en e-mail oplyst på{" "}
                <Link to="/help" className="text-cz-accent-t underline">Hjælp-siden</Link>.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="2. Hvad du køber" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                CZ Pro er et frivilligt støtte-abonnement til browserspillet Cycling Zone. Pro giver adgang til ekstra dybde, komfort og kosmetiske funktioner, aldrig en konkurrencefordel. Gratis-spillet er og bliver fuldt spilbart og konkurrencedygtigt uden Pro.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="3. Pris og betaling" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <ul className="list-disc pl-5 space-y-1">
                <li>Månedligt abonnement: 49 kr. pr. måned.</li>
                <li>6-måneders abonnement: 265 kr. pr. 6 måneder.</li>
                <li>Priser opkræves i danske kroner når du spiller Cycling Zone på dansk, og i euro når du spiller på engelsk. Spillets sprog afgør valutaen.</li>
                <li>Alle priser er den samlede pris du betaler, inkl. eventuel moms. Der lægges ikke gebyrer eller tillæg oveni.</li>
                <li>Betaling sker via vores betalingsudbyder Alunta. Vi opbevarer aldrig dine kortoplysninger.</li>
              </ul>
            </div>
          </Section>

          <Section>
            <SectionHeader title="4. Automatisk fornyelse" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Abonnementet fornyes automatisk ved udløbet af hver periode (måned hhv. 6 måneder) til den til enhver tid gældende pris, indtil du opsiger. Du får en kvittering pr. e-mail ved hver betaling. Prisændringer varsles mindst 30 dage før de træder i kraft; en prisændring giver dig altid ret til at opsige inden den nye pris gælder.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="5. Opsigelse" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Du kan opsige når som helst med virkning fra udløbet af den igangværende betalte periode. Der er ingen binding ud over perioden. Opsigelse sker via &quot;Administrér abonnement&quot; i dine{" "}
                <Link to="/profile" className="text-cz-accent-t underline">kontoindstillinger</Link>, som åbner selvbetjeningsportalen hos vores betalingsudbyder. Du kan også altid kontakte os (jf. pkt. 1), så opsiger vi manuelt samme dag.
              </p>
              <p className="mt-2">
                Allerede betalte perioder refunderes ikke ved opsigelse, men Pro-funktionerne virker perioden ud.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="6. Fortrydelsesret" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Du har som forbruger 14 dages fortrydelsesret ved køb på nettet. <strong>Bemærk:</strong> CZ Pro er digitalt indhold/en digital tjeneste der leveres straks. Ved købet samtykker du udtrykkeligt til, at leveringen påbegyndes med det samme, og du anerkender, at fortrydelsesretten dermed bortfalder for den påbegyndte periode.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="7. Founder-status" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                De første 50 betalende abonnenter får permanent Founder-status (badge). Founder-badget bevares permanent, også hvis abonnementet senere ophører. Founder-status er kosmetisk.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="8. Beta-forbehold" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Cycling Zone er i åben beta. Funktioner, også Pro-funktioner, kan ændres, ombalanceres eller fjernes som led i spillets udvikling. Væsentlige forringelser af Pro&apos;s indhold giver dig ret til at opsige, jf. pkt. 5. Vi kan lukke spillet med mindst 30 dages varsel; forudbetalte perioder ud over lukkedatoen refunderes forholdsmæssigt.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="9. Reklamation og tvister" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Køb er omfattet af købelovens/forbrugerreglernes almindelige mangelsbeføjelser. Klager rettes først til os (jf. pkt. 1). Du kan desuden klage til Nævnenes Hus / Center for Klageløsning, og EU-Kommissionens onlinetvistplatform (ODR) kan benyttes.
              </p>
            </div>
          </Section>

          <Section>
            <SectionHeader title="10. Persondata" />
            <div className="text-cz-2 text-sm leading-relaxed">
              <p>
                Behandling af persondata er beskrevet i{" "}
                <Link to="/privatlivspolitik" className="text-cz-accent-t underline">privatlivspolitikken</Link>.
              </p>
            </div>
          </Section>
        </SectionStack>
      </div>
    </div>
  );
}
