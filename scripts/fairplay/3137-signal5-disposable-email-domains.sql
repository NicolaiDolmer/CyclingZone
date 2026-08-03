-- =============================================================================
-- Signal 5 — Disposable / throwaway email domains  (#3137, epic #3131)
-- =============================================================================
-- Question: does this account use a known or heuristically-disposable email
-- domain? Per the issue: "gwshare.com, yopmail.com, atomicmail.io findes
-- allerede i brugerbasen. Svagt alene (folk bruger temp-mail lovligt), men
-- stærkt i kombination" — i.e. this signal is DELIBERATELY low-confidence by
-- itself; #3138 is expected to combine it with the others.
--
-- Output contract: signal_name, team_id, user_id, event_at, strength, evidence
-- (see 3137-signal1-account-age-at-transaction.sql for the full description).
--
-- Design ("data-driven + static core", per the task):
--
-- 1. STATIC CORE: a curated list of ~140 widely-known public disposable/
--    temp-mail providers (the same class of list used by the open-source
--    `disposable-email-domains` community lists). All 3 domains already
--    confirmed present in this game's userbase (gwshare.com, yopmail.com,
--    atomicmail.io) are included, plus common providers (mailinator,
--    guerrillamail family, 10/20-minute-mail, trashmail, sharklasers,
--    dispostable, maildrop, getnada, moakt, tempmail family, etc). This list
--    will drift over time (providers appear/disappear) — it is NOT
--    exhaustive and should be periodically reconciled against a maintained
--    public list. A stale entry that nobody uses is harmless (zero matches);
--    the risk is only ever under-matching, never a false accusation, since
--    match_type is reported and #3138 treats this as one weak signal among
--    several.
--
-- 2. DATA-DRIVEN HEURISTIC: a regex over the domain name itself catching
--    common disposable-provider naming patterns (temp/trash/fake/disposable/
--    burner/guerrilla/throwaway/mailinator/minute/discard/dropmail/maildrop/
--    getnada/moakt/yopmail/spam/nospam/anonym/10min/20min), scored lower than
--    a static-core hit since it's pattern-based, not a known-provider match.
--    Verified 2026-08-03: against the current userbase this heuristic adds
--    zero NEW matches beyond the 3 known static-core domains — i.e. today it
--    is a no-op safety net, not a source of extra noise.
--
-- 3. Deliberately capped strength (core=0.55, heuristic=0.30): per the
--    issue's own framing this signal must never dominate a score on its own.
--    Evidence includes engagement context (level/xp/balance) so a human
--    reviewer — or #3138's combination logic — can see at a glance whether a
--    disposable-domain account is otherwise engaged (weak) or freshly
--    created + inactive (stronger in combination with signals 1/6).
--
-- Window: accounts created in the last 90 days (in practice this covers
-- almost the whole userbase — the game launched 2026-05-08).
-- =============================================================================

WITH core_disposable_domains(domain) AS (
  VALUES
    -- confirmed present in this userbase (issue body, verified 2026-08-03)
    ('gwshare.com'), ('yopmail.com'), ('atomicmail.io'),
    -- widely-known public disposable/temp-mail providers (static core)
    ('mailinator.com'), ('mailinator.net'), ('mailinator2.com'),
    ('guerrillamail.com'), ('guerrillamail.info'), ('guerrillamail.biz'),
    ('guerrillamail.de'), ('guerrillamail.org'), ('guerrillamail.net'), ('grr.la'),
    ('10minutemail.com'), ('10minutemail.net'), ('10minutemail.org'), ('20minutemail.com'),
    ('tempmail.com'), ('temp-mail.org'), ('temp-mail.io'), ('tempmailo.com'),
    ('tempmail.ninja'), ('tempr.email'), ('tmpmail.org'), ('tmpbox.net'), ('tmpeml.info'),
    ('throwawaymail.com'), ('sharklasers.com'), ('dispostable.com'),
    ('trashmail.com'), ('trash-mail.com'), ('trashmail.de'), ('wegwerfemail.de'),
    ('maildrop.cc'), ('getnada.com'), ('moakt.com'), ('moakt.cc'),
    ('fakeinbox.com'), ('emailondeck.com'), ('mytemp.email'), ('mohmal.com'),
    ('discard.email'), ('mailcatch.com'), ('spambog.com'), ('mailnesia.com'),
    ('pokemail.net'), ('dropmail.me'), ('harakirimail.com'), ('incognitomail.com'),
    ('jetable.org'), ('spamgourmet.com'), ('mailforspam.com'), ('meltmail.com'),
    ('1secmail.com'), ('crazymailing.com'), ('fake-mail.net'), ('emailfake.com'),
    ('mailnull.com'), ('no-spam.ws'), ('nospam.ws'), ('spamfree24.org'),
    ('tempemail.net'), ('tempemail.com'), ('tempinbox.com'), ('mailexpire.com'),
    ('mytrashmail.com'), ('willselfdestruct.com'), ('anonymbox.com'),
    ('deadaddress.com'), ('despam.it'), ('emailsensei.com'), ('emailwarden.com'),
    ('filzmail.com'), ('fleckens.hu'), ('gishpuppy.com'), ('greensloth.com'),
    ('ipoo.org'), ('jourrapide.com'), ('killmail.com'), ('klassmaster.com'),
    ('mailbucket.org'), ('mailimate.com'), ('mailin8r.com'), ('mailinater.com'),
    ('mt2015.com'), ('mt2014.com'), ('mt2009.com'), ('netmails.net'),
    ('objectmail.com'), ('proxymail.eu'), ('rcpt.at'), ('safetymail.info'),
    ('selfdestructingmail.com'), ('sneakemail.com'), ('snakemail.com'),
    ('spamavert.com'), ('spamcannon.com'), ('spaml.com'), ('thanksnospam.info'),
    ('thisisnotmyrealemail.com'), ('tmail.ws'), ('tradermail.info'), ('trbvm.com'),
    ('tyldd.com'), ('veryrealemail.com'), ('inboxkitten.com'), ('mailsac.com'),
    ('burnermail.io'), ('luxusmail.org'), ('mintemail.com'), ('mailmetrash.com'),
    ('thankyou2010.com'), ('sogetthis.com'), ('spamex.com'), ('wh4f.org'),
    ('xoxy.net'), ('zoemail.org'), ('einrot.com'), ('correotemporal.org'),
    ('emailtemporanea.com'), ('spam4.me'), ('yopmail.fr'), ('yopmail.net')
)
SELECT
  'lifecycle_disposable_email_domain' AS signal_name,
  t.id AS team_id,
  u.id AS user_id,
  u.created_at AS event_at,
  CASE WHEN c.domain IS NOT NULL THEN 0.55 ELSE 0.30 END AS strength,
  jsonb_build_object(
    'team_name', t.name,
    'user_email', u.email,
    'email_domain', lower(split_part(u.email, '@', 2)),
    'match_type', CASE WHEN c.domain IS NOT NULL THEN 'static_core' ELSE 'heuristic_pattern' END,
    'user_created_at', u.created_at,
    'level', u.level,
    'xp', u.xp,
    'login_streak', u.login_streak,
    'last_seen', u.last_seen,
    'balance', t.balance
  ) AS evidence
FROM users u
JOIN teams t ON t.user_id = u.id
LEFT JOIN core_disposable_domains c ON c.domain = lower(split_part(u.email, '@', 2))
WHERE t.is_ai = false AND t.is_test_account = false
  AND u.email NOT ILIKE '%@cyclingzone.dev'
  AND u.created_at >= now() - interval '90 days'
  AND (
    c.domain IS NOT NULL
    OR lower(split_part(u.email, '@', 2)) ~
       '(temp|trash|fake|disposable|burner|guerrilla|throwaway|mailinator|minute|discard|dropmail|maildrop|getnada|moakt|yopmail|spam|nospam|anonym|10min|20min)'
  )
ORDER BY strength DESC, u.created_at DESC;
