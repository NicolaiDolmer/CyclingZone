# Postmortem · 2026-09-23 · Ny CI-gate + parallel PR = rød main

Refs #5534 #5313 #3556.

## Hvad skete der?
Main-CI blev rød (frontend-build) kl. 18:33, lige efter #5559 blev merget. Begge de sidste to PR'er
(#5514 og #5559) var grønne hver for sig, og merge-køen tog dem med 5 minutters mellemrum.

## Root cause
#5559 indførte en NY gate: `tsc --noEmit -p tests` typetjekker e2e-specs i .ts. #5514 tilføjede en
ny spec (`messages-thread-scroll.spec.ts`) med fem parametre uden type. #5559's CI kørte før #5514
lå på main, og #5514's CI kørte før gaten fandtes. Ingen af dem blev nogensinde kørt mod den
kombination, der endte på main. `merge-queue.ps1` tjekker at de påkrævede checks er grønne, men
ikke at de er kørt mod den nuværende main.

## Fix
#5584 (f08b131ae): typer på parametrene (`Page`/`Route` + en lokal `MessagesMockState`). Merget kl.
18:49, main-CI grøn igen ca. kl. 19. Den anden session blev advaret om, at røde frontend-builds på dens PR'er skyldtes main.

## Forhindret-fremover
#3556 (merge queue på main) løser klassen: hver PR testes mod main + PR'erne foran den. Indtil da:
en PR der indfører en ny gate over EKSISTERENDE filer (ny lint-regel, nyt typecheck-scope, ny
guard) merges sidst i en kø, eller dens CI genkøres på den nyeste main lige før merge.

## Læring
En gate-PR ændrer hvad "grøn" betyder for alle andre åbne PR'er. Den er ikke en almindelig PR i
køen: den skal testes mod det main, den faktisk lander på.
