# AI/Ops cost model for 5,000–10,000 active users

**Status:** Proposed planning baseline  
**Date:** 2026-05-14  
**Owner:** Manus AI  
**Issue:** [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332)  
**Parent:** [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)

---

## Purpose

This document turns the cost-model part of #332 into a concrete planning baseline. It is not a vendor invoice forecast. It is a **decision-support model** that shows what CyclingZone should expect to pay if the current stack scales toward 5,000–10,000 active users while remaining on the current Vercel, Railway, and Supabase architecture, with Upstash Redis added only if the cache ADR is approved.

The most important conclusion is that **the current architecture should not become expensive at 5k–10k users unless traffic patterns are very inefficient or the project moves into enterprise/SLA tiers too early**. The practical risk is less “monthly SaaS bill explosion” and more operational blind spots: missing backup restore drills, unclear P95 latency targets, cache invalidation mistakes, and degraded behavior during provider outages.

---

## Verified provider facts

The model uses primary provider pages checked on 2026-05-14. Vercel lists Pro from **$20/month** for one developer seat and usage-based add-ons such as Speed Insights and Web Analytics.[^1] Railway’s pricing docs list Free, Hobby at **$5/month**, Pro at **$20/month**, and usage charges for RAM, CPU, network egress, and volume storage; the Pro plan includes $20 of resource usage per month before overage applies.[^2] Supabase lists Pro from **$25/month**, including 100,000 monthly active users, 8 GB disk, 250 GB egress, and 100 GB file storage before overages.[^3] Upstash Redis lists a free tier, pay-as-you-go Redis commands at **$0.20 per 100,000 commands**, and a fixed 250 MB Redis plan at **$10/month**.[^4]

| Provider | Current role in CyclingZone | Official baseline used | Relevant included capacity |
|---|---|---:|---|
| Vercel | Frontend hosting, analytics, Speed Insights. | $20/month Pro seat. | Usage-based analytics and build/runtime add-ons; Web Analytics includes 50,000 events/month and Speed Insights includes 10,000 events/month before extra usage on the pricing page.[^1] |
| Railway | Backend API runtime. | $20/month Pro plan. | $20 included resource usage/month; RAM $10/GB/month, CPU $20/vCPU/month, egress $0.05/GB.[^2] |
| Supabase | Postgres, auth, storage, realtime. | $25/month Pro project. | 100,000 MAUs, 8 GB disk, 250 GB egress, 250 GB cached egress, 100 GB file storage.[^3] |
| Upstash Redis | Proposed shared cache/rate-limit store. | $0–$10+ depending on usage. | Free: 256 MB and 500k monthly commands; pay-as-you-go: $0.20 per 100k commands; fixed 250 MB: $10/month.[^4] |

---

## Assumptions

This baseline assumes CyclingZone remains a single frontend project, a small Railway backend, and one Supabase project. It assumes 5,000–10,000 active users means active managers or community users, not 10,000 simultaneous users. It also assumes the backend continues to keep business state in Supabase, while Redis is only a shared operational store if #334 is approved.

| Assumption | 5k active-user tier | 10k active-user tier | Why it matters |
|---|---:|---:|---|
| Monthly active users in Supabase Auth | 5,000 | 10,000 | Both are far below Supabase Pro’s 100,000 MAU inclusion.[^3] |
| Frontend analytics events | 250k–750k/month | 500k–1.5M/month | This is likely the first Vercel add-on that becomes visible if analytics is enabled broadly.[^1] |
| Backend runtime footprint | 0.25–0.5 vCPU, 0.5–1 GB RAM | 0.5–1 vCPU, 1–2 GB RAM | Railway charges by consumed CPU/RAM, with Pro usage credit absorbing early usage.[^2] |
| Database size | Under 8 GB | Under 8 GB unless logs/history grow quickly | Supabase Pro includes 8 GB disk before overage.[^3] |
| Redis commands | 1M–10M/month if introduced | 5M–30M/month if introduced | Determines whether Upstash pay-as-you-go or fixed pricing is cheaper.[^4] |

---

## Monthly cost baseline

The table below gives three numbers per tier: **minimum**, **planned**, and **watch-point**. Minimum means the current stack with disciplined usage and few add-ons. Planned means a realistic small-production setup with analytics and a Redis/cache baseline. Watch-point is not a forecast; it is the level where the project should stop and review usage before adding more features or vendor tiers.

| User tier | Minimum monthly platform cost | Planned monthly platform cost | Watch-point requiring review |
|---|---:|---:|---:|
| 5,000 active users | $65 | $95–$140 | $250/month |
| 10,000 active users | $65–$90 | $130–$220 | $400/month |

The minimum tier is simply Vercel Pro, Railway Pro, and Supabase Pro. That is approximately **$65/month** before optional analytics usage and cache spend. The planned tier adds Vercel analytics/Speed Insights allowance, modest Railway usage above the included credit if needed, and an Upstash Redis fixed or low pay-as-you-go plan. The watch-point exists because a hobby-to-professional game should not silently drift into enterprise pricing without evidence from revenue, traffic, or reliability incidents.

---

## Provider-level planning table

| Provider | 5k planned estimate | 10k planned estimate | Trigger for review |
|---|---:|---:|---|
| Vercel | $30–$55 | $45–$90 | Analytics or Speed Insights event volume grows faster than active users; build minutes spike; additional paid seats are added. |
| Railway | $20–$35 | $25–$60 | Backend CPU/RAM usage exceeds the Pro included resource credit, or a second backend instance becomes necessary. |
| Supabase | $25 | $25–$50 | Database disk approaches 8 GB, egress approaches 250 GB, realtime message load creates measurable latency, or backup/restore needs require a higher operational tier. |
| Upstash Redis | $0–$20 | $10–$40 | Cache command volume becomes steady enough to justify fixed pricing, or SLA/security requirements justify Prod Pack. |
| **Total** | **$75–$135** | **$105–$240** | Investigate if monthly platform cost crosses the watch-point without an explainable traffic/reliability cause. |

This model deliberately keeps Supabase Pro in place at 5k–10k because the official Pro MAU limit is much higher than the target range. The project should not move to Supabase Team or enterprise pricing merely because user count reaches 10k; it should move only because compliance, backup controls, support/SLA, or actual resource pressure requires it.

---

## Cost controls

Cost control should be automated where possible. Vercel’s spend controls should be enabled before broad analytics instrumentation. Railway resource usage should be reviewed after every backend scaling change. Supabase table growth should be tracked monthly, especially audit/history tables and any future upload or image storage. Upstash should start on free or low pay-as-you-go usage and switch to fixed pricing only after command volume is measured.

| Control | Owner | Cadence | Escalation threshold |
|---|---|---|---|
| Vercel usage dashboard review | Manus/Claude ops session | Monthly during beta; weekly after launch spikes. | More than $50/month above planned tier. |
| Railway CPU/RAM review | Backend owner | After each deploy that changes polling, realtime, or cron workload. | Sustained use above Pro included credit. |
| Supabase disk/egress review | Database owner | Monthly. | Disk above 6 GB or egress above 150 GB. |
| Redis command review | Cache slice owner | Weekly for the first month after rollout. | Pay-as-you-go exceeds fixed-plan equivalent. |
| Total platform cost review | Nicolai + Manus | Monthly. | $250/month at 5k or $400/month at 10k without a revenue or reliability reason. |

---

## Decision implications

This cost model supports three roadmap decisions. First, #334 should choose a small managed Redis rollout rather than self-hosting. Second, #332 should include backup/restore and incident cadence before expensive enterprise tiers. Third, #323 should track concrete operating thresholds rather than generic “scale hardening” tasks.

If the project approaches the watch-point thresholds, the next action should be a usage-based review, not an automatic migration. The correct question is: **which metric is driving cost, and does that metric also improve player experience or reliability?**

---

## References

[^1]: [Vercel Pricing](https://vercel.com/pricing).
[^2]: [Railway Docs — Pricing Plans](https://docs.railway.com/pricing/plans).
[^3]: [Supabase Pricing](https://supabase.com/pricing).
[^4]: [Upstash Pricing](https://upstash.com/pricing).
