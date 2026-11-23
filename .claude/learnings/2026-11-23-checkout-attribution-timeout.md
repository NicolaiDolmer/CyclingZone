# Checkout-attribution og betalingsloggen

Kampagneopslaget var asynkront, men betalingsloggen ventede stadig på dets resultat. Et opslag uden svar kunne derfor forhindre logningen. En afgrænset Promise.race sikrer en basal betalingslog ved timeout. Kampagnenøglen normaliseres til små bogstaver, så event og dagsudgift deler samme nøgle.
