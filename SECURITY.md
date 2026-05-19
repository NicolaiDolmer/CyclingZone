# Security Policy

Cycling Zone is a small, single-maintainer project. If you find a security
issue, please report it responsibly — do **not** open a public GitHub issue.

## Reporting a vulnerability

**Preferred:** use GitHub's private vulnerability reporting:
https://github.com/NicolaiDolmer/CyclingZone/security/advisories/new

**Alternative:** email `nicolai.dolmer.mikkelsen@gmail.com` with subject
`[SECURITY] CyclingZone`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (or a minimal proof-of-concept).
- Affected URL, route, or component.
- Browser/OS if relevant.

## Response SLA

- **Acknowledgement:** within 72 hours.
- **Initial assessment:** within 7 days.
- **Fix or mitigation timeline:** communicated after assessment.

## Scope

**In scope**

- The live site at https://cycling-zone.vercel.app
- Source code on the `main` branch of this repository
- Auth, authorization, RLS bypass, data exposure, injection, XSS, CSRF,
  business-logic flaws (e.g. economy/auction abuse, score manipulation)

**Out of scope**

- Issues requiring physical access to a victim's device.
- Social engineering of the operator or other players.
- Reports based solely on automated scanner output without a working
  proof-of-concept.
- Issues in third-party services (Supabase, Vercel, Discord, GitHub) —
  report those to the relevant vendor.
- Denial-of-service via volumetric attacks.
- Self-XSS or attacks that require a victim to paste attacker-controlled
  content into devtools.

## Coordinated disclosure

I'll publish a GitHub Security Advisory and credit you (if you wish) once
a fix is deployed. Please give a reasonable amount of time to address the
issue before public disclosure — typically 90 days, or sooner if a fix
ships earlier.

## No bug bounty

This is a small hobby/beta project with no monetary bounty program. I do
acknowledge reporters publicly on the advisory (with your consent) and
thank you sincerely — security reports are a real gift.
