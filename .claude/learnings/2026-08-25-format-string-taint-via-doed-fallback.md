# Et dødt `|| req.params.id`-fallback var hele taint-stien

**Dato:** 2026-08-25 · **PR:** #4251 · **Alarm:** CodeQL #188 (High, `js/tainted-format-string`)

## Symptom

CodeQL flagede `backend/lib/notificationService.js:994` — `console.error` med et
template-literal der interpolerede `postId`. Ti næsten identiske linjer i samme fil
(`rider.id`, `race?.id`, `teamId` …) blev **ikke** flaget.

## Hvorfor kun den ene

Forskellen var ikke formen, men kilden. De andre id'er kommer fra DB-rækker.
`postId` kom fra `routes/api.js`:

```js
postId: result.post?.id || req.params.id,
```

`req.params.id` er rå bruger-input. CodeQL sporede den hele vejen ind i
format-string-positionen. Med `postId === "%s"` slugte Node's `util.format`
det efterfølgende `err`-argument:

```
  ❌ forum-thread-reply-notifikation fejlede (post boom %d %j):
```

Fejlbeskeden forsvandt fra loggen — præcis den log man skal bruge når
forum-notifikationer fejler.

## Pointen

Fallbacket var **dødt kode**. `createForumReply` returnerer altid
`post: { id, title, category, user_id }` ved `status === 200`
(`backend/lib/forum.js:528-570`), og kaldet ligger inde i `if (result.status === 200)`.
`|| req.params.id` kunne aldrig ramme — den eneste effekt den nogensinde havde,
var at åbne taint-stien.

## Regel fremadrettet

1. **Utrusteret data hører aldrig i første argument til `console.*`.** Brug
   `console.error("... %s", værdi, err)` — substituerede værdier gen-fortolkes ikke.
2. **Et `|| fallback` på en værdi der altid findes, er ikke gratis.** Det udvider
   værdiens herkomst fra "DB" til "hvad som helst", og statiske analyser regner
   med den bredeste gren. Slet det i stedet for at forsvare det.
3. **Når CodeQL flager én ud af ti ens linjer: led efter kilden, ikke formen.**
   At "rette" alle ti havde skjult at kun én havde et reelt problem — og at
   problemet lå i et andet lag (routen), ikke i loglinjen.

## Verifikation

Regressionstest i `notificationService.test.js` kørt **rød uden fixet**
(`AssertionError: id skal logges ordret, fik: ... (post boom %d %j):`) og grøn med.
Fuld backend-suite: 7180/7180.
