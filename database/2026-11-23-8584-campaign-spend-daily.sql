-- Refs #8584. One consolidated ad-spend total in DKK minor units per report day and campaign.
-- data-api-access: {"table":"public.campaign_spend_daily","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE"]},"reason":"Private campaign reporting and the operator's daily spend upsert"}
BEGIN;
CREATE TABLE IF NOT EXISTS public.campaign_spend_daily (
  utm_campaign text NOT NULL CHECK (utm_campaign ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  spend_date date NOT NULL,
  amount_ore integer NOT NULL CHECK (amount_ore >= 0),
  PRIMARY KEY (utm_campaign, spend_date)
);
ALTER TABLE public.campaign_spend_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_spend_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.campaign_spend_daily TO service_role;
COMMIT;
