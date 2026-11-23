# First-touch-kampagne på signup-milepæle

Når marketing og SPA åbner hver sit dokument, går PostHogs anonyme ID tabt ved navigation. Brug kontooprettelsens first-touch-snapshot på identificerede signup-milepæle. Query-strengen på den aktuelle side beskriver kun det aktuelle besøg.

Ved bekræftelse af signup foretrækker vi auth-metadata fra oprettelsen, så en anden browsers lokale snapshot ikke overtager kampagnen. Serverens første-løb-event bruger den autoritative signup-attribution efter deduplikering og samtykkefilter. Test den faktiske SDK-payload, inklusive `$set_once` og fravær af click-ID'er.
