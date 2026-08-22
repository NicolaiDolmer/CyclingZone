-- #3750 · Akademiryttere skal med i løn-forhåndsvisningen (ejer-krav 22/8).
-- Preview-tabellen får et is_academy-flag: løn-fanen tæller dem med (søndagens
-- genberegning omfatter dem), værdi-fanen holder dem ude (deres værdi er
-- symbolsk indtil første søndag, #4001). Idempotent.
ALTER TABLE value_transition_preview
  ADD COLUMN IF NOT EXISTS is_academy boolean NOT NULL DEFAULT false;
