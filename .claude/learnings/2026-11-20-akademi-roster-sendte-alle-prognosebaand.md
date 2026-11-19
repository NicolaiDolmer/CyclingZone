# Akademi-rosteren sendte alle prognosebånd i stedet for ét (#8400, PR #8464)

**Hvad skete der:** `/api/academy/me` sendte rosteren prognosebånd for alle roller, selvom rosteren kun skal vise det valgte bånd og kendskabsstatus. Scoutrapporten er det eneste sted, der må have alle roller. Svaret var bredere end visningen behøvede og afslørede mere, end rosteren skulle vise.

**Rodårsag:** roster og scoutrapport delte samme svarform, så scoutrapportens "alle roller" lækkede ind i rosterens svar.

**Rettelse:** `/api/academy/me` sender nu ét valgt bånd pr. rytter plus kendskabsstatus. Scoutrapporten er uændret.

**Forebyggelse:** en regressionstest låser rosterens svarform (ét bånd), så et for bredt svar fanges i CI. Generelt: når to flader deler et endpoint eller en svarform, skal den smalleste flade have sin egen afgrænsning og en test for, hvad der IKKE må sendes.
