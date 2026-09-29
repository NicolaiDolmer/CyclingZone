# #5847: auktion brugte sæson 1 mellem to sæsoner

Ved S3→S4 kunne en allerede startet auktion blive finaliseret efter at S3 var
markeret afsluttet, men før S4 var aktiv. `auctionFinalization.js` slog kun en
`active` sæson op og brugte sæson 1, når svaret var tomt. En kontraktløs
auktionsrytter fik dermed et udløb før den kommende sæson. Sæsonskiftets
kontraktudløb frigav efterfølgende rytteren fra køberen.

Rettelsen opløser erhvervelsessæsonen fra den tidligste kommende sæson eller
senest afsluttede sæson + 1. Mangler gyldig sæsonkontekst, fejler finaliseringen
i stedet for at gætte. `season_id` på finansposten er fortsat kun den faktisk
aktive sæson, og handler med eksisterende kontrakt arver den uændret.

Forebyggelse: deterministiske integrationstests finaliserer en auktion i
vinduet `completed S3` / `upcoming S4` samt med kun `completed S3` og kræver
kontrakt til og med S5. Testene blev først kørt røde mod fallback til sæson 1
og derefter grønne med rettelsen.
