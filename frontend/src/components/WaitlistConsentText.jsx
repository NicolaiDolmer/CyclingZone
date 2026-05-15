import { Link } from "react-router-dom";

/**
 * Samtykke-tekst der embeddes i Founder Supporter-waitlist-formularen (#360 / #362).
 *
 * Bruges sammen med en IKKE-pre-tjekket checkbox. Selve checkbox-state styres af parent.
 * Komponenten leverer KUN labelteksten + privatlivspolitik-link, ikke selve input-feltet,
 * så waitlist-form kan styre validering + submit.
 *
 * `lang="en"` skifter til engelsk og linker til /privacy-policy i stedet for /privatlivspolitik.
 */
export default function WaitlistConsentText({ lang = "da" }) {
  if (lang === "en") {
    return (
      <span>
        I consent to Cycling Zone storing my contact info and waitlist responses to be contacted
        about the Founder Supporter launch. I understand that this is{" "}
        <strong>non-binding</strong> and that I can be deleted at any time. See the{" "}
        <Link to="/privacy-policy" className="text-cz-accent-t underline" target="_blank" rel="noopener noreferrer">
          privacy policy
        </Link>{" "}
        for full details.
      </span>
    );
  }

  return (
    <span>
      Jeg giver samtykke til at Cycling Zone opbevarer mine kontaktoplysninger og
      waitlist-svar med henblik på at kontakte mig om Founder Supporter-lanceringen. Jeg
      forstår at dette er <strong>uforpligtende</strong>, og at jeg til enhver tid kan
      bede om at blive slettet. Se{" "}
      <Link to="/privatlivspolitik" className="text-cz-accent-t underline" target="_blank" rel="noopener noreferrer">
        privatlivspolitikken
      </Link>{" "}
      for fulde detaljer.
    </span>
  );
}
