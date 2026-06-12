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
    // 1. Tjek Salary-konsistens
    // Salary skal være 10% af (UCI points * 4000 + bonus), min 5 UCI points.
    const { error: salaryError } = await supabase.rpc('check_salary_drift');
    
    // Hvis RPC ikke findes endnu, bruger vi en rå query (fallback)
    if (salaryError) {
      const { data: riders, error: queryError } = await supabase
        .from('riders')
        .select('id, name, salary, uci_points, prize_earnings_bonus')
        .not('team_id', 'is', null);

      if (!queryError) {
        riders.forEach(r => {
          const expected = Math.round(Math.max((Math.max(r.uci_points, 5) * 4000 + (r.prize_earnings_bonus || 0)) * 0.10, 1));
          if (Math.abs(r.salary - expected) > 1) {
            issues.push(`Salary Drift: Rider ${r.name} (${r.id}) has ${r.salary}, expected ${expected}`);
          }
        });
      }
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
