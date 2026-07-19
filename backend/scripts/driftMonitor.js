/**
 * Loop A · Drift-monitor
 * Verificerer økonomisk konsistens og system-invarianter.
 * Kører dagligt via GitHub Actions.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: { transport: ws },
  }
);

async function runAudit() {
  console.log('=== Starting Drift Monitor Audit ===');
  const issues = [];

  try {
    // 1. Tjek Salary-invarianter (#2594): løn er FROSSEN ved signering og re-prises
    // kun ved forlængelse, så en formel-sammenligning mod live-værdier ville flagge
    // enhver trænet rytter. Invarianterne der SKAL holde: (a) alle ejede ryttere har
    // salary != null (#1309), (b) ingen løn over runaway-loftet (G4: sponsor 240k).
    //
    // #2674: der findes ingen check_salary_drift-RPC i databasen (aldrig oprettet
    // post-#2594) — JS-checket nedenfor er eneste vej (billigt, intet SQL at
    // vedligeholde). Scope: KUN menneske-ejede ryttere (owner_is_ai=false) —
    // #1309-invarianten gælder manager-signeringer; AI-/bank-ejede har legitimt
    // salary=null (verificeret i prod 18/7: 4.322 AI-ejede uden løn vs 1.608 med).
    const SALARY_RUNAWAY_CEILING = 240000; // = sæson-sponsoratet (G4-loftet)
    const { data: riders, error: queryError } = await supabase
      .from('riders')
      .select('id, firstname, lastname, salary')
      .not('team_id', 'is', null)
      .eq('owner_is_ai', false);

    if (!queryError) {
      riders.forEach(r => {
        const name = `${r.firstname ?? ''} ${r.lastname ?? ''}`.trim();
        if (r.salary == null) {
          issues.push(`Salary Drift: Rider ${name} (${r.id}) er manager-ejet men har salary=null (#1309-invariant)`);
        } else if (Number(r.salary) > SALARY_RUNAWAY_CEILING) {
          issues.push(`Salary Drift: Rider ${name} (${r.id}) har løn ${r.salary} > runaway-loft ${SALARY_RUNAWAY_CEILING}`);
        }
      });
    }

    // 2. Tjek Squad Limits
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, division, riders(id)')
      .eq('is_ai', false)
      .eq('is_bank', false)
      .eq('is_frozen', false);

    if (!teamsError) {
      const limits = { 'D1': { min: 25, max: 30 }, 'D2': { min: 20, max: 28 }, 'D3': { min: 15, max: 25 } };
      teams.forEach(t => {
        const count = t.riders.length;
        const limit = limits[t.division] || { min: 0, max: 99 };
        if (count < limit.min || count > limit.max) {
          issues.push(`Squad Limit Violation: Team ${t.name} (${t.division}) has ${count} riders (Limit: ${limit.min}-${limit.max})`);
        }
      });
    }

    // 3. Tjek forældreløse ryttere
    const { data: orphanRiders, error: orphanError } = await supabase
      .from('riders')
      .select('id, name, team_id')
      .not('team_id', 'is', null);

    if (!orphanError) {
      const { data: allTeams } = await supabase.from('teams').select('id');
      const teamIds = new Set(allTeams.map(t => t.id));
      orphanRiders.forEach(r => {
        if (!teamIds.has(r.team_id)) {
          issues.push(`Orphan Rider: ${r.name} (${r.id}) points to non-existent team ${r.team_id}`);
        }
      });
    }

    // Rapportér resultater
    if (issues.length > 0) {
      console.error('❌ Drift detected:');
      issues.forEach(msg => console.error(` - ${msg}`));
      
      // Discord Notifikation
      if (process.env.DISCORD_WEBHOOK_URL) {
        const message = {
          embeds: [{
            title: "🚨 DRIFT DETECTED - CyclingZone Audit",
            description: issues.map(i => `• ${i}`).join('\n'),
            color: 16711680, // Rød
            timestamp: new Date().toISOString()
          }]
        };
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message)
        });
      }
      
      process.exit(1);
    } else {
      console.log('✅ No drift detected. System is consistent.');
    }

  } catch (err) {
    console.error('Fatal error during audit:', err);
    process.exit(1);
  }
}

runAudit();
