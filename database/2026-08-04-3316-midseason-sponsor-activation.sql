-- 2026-08-04 · Mid-season sponsor-onboarding (#3316)
--
-- Fund (sponsor-audit 4/8): nye hold oprettet MIDT i en sæson havde ingen vej
-- til sponsorindtægt i den sæson de faktisk spillede — et valgt tilbud blev
-- skrevet som 'pending' og aktiverede først ved NÆSTE sæsonskifte
-- (sponsorContractsService.js:339-416), så enhver ny signup spillede sin
-- første sæson helt sponsorløs (D4: 21/33 hold ramt, alle oprettet efter
-- S2-start).
--
-- Ejer-beslutning (4/8, løsning A): et hold UDEN aktiv kontrakt midt i sæsonen
-- får tilbud straks, og accept aktiverer kontrakten MED DET SAMME. Rammer:
-- race-day-rate + bonusklausuler gælder fra aktiverings-tidspunktet (ingen
-- bagudbetaling for løb før accept); INGEN garanteret base for indeværende
-- sæson (guaranteed_base udbetales stadig kun ved den næste rigtige
-- sæson-start, som normalt — economyEngine.processSeasonStart kører ikke om
-- igen for at "fange" et hold der kom til efter den allerede kørte).
--
-- activated_at bruges af sponsorRaceDayIncome til at udelukke løb der blev
-- completet FØR aktiveringstidspunktet, så en mid-season-aktivering aldrig
-- kan bagudbetale for løb holdet allerede har kørt uden kontrakt.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Nullable, ingen default — eksisterende
-- rækker (season-start-aktiverede kontrakter, hvoraf ingen har spillet løb
-- FØR deres kontrakt var aktiv) forbliver NULL og behandles som "altid
-- kvalificeret, ingen filtrering" — adfærden for de ~200 eksisterende aktive
-- kontrakter er derfor uændret.
ALTER TABLE public.sponsor_contracts
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sponsor_contracts.activated_at IS
  '#3316: hvornår kontrakten reelt gik i drift (mid-season-aktivering). NULL = season-start-aktiveret, ingen filtrering. Sat eksplicit af sponsorContractsService.acceptOfferImmediately, så sponsorRaceDayIncome kan udelukke løb completet FØR dette tidspunkt (ingen bagudbetaling).';
