# Sæsonens trupoprykning og salg (#7323)

Det gamle gradueringsvalg kunne oprette en ekstra auktion, selv om rytteren allerede var sat til salg. En usolgt gradueringsauktion kunne efterfølgende udløse en ny trupbeslutning eller frigivelse.

Sæsonskiftet flytter nu den aktuelle ejers rytter direkte. Trup og historik skrives atomisk. Igangværende salg beholder deres forløb, og den gamle deadline-kørsel er taget ud af cron. En automatisk oprykning giver hverken adgang til nye køb eller grund til tvangssalg.

Regressionsbeviser ligger i `seasonSquadPromotion.integration.test.js`, `squadEnforcement.test.js` og `auctionFinalization.test.js`. Dæk samspillet med et allerede afgivet bud ved at lægge buddet før oprykningen og afregningen efter.
