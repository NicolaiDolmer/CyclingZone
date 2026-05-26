const env = globalThis['process']['env'];
const expected = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'FRONTEND_URL', 'PORT', 'DISCORD_DM_TARGET'];
const found = expected.filter(k => typeof env[k] === 'string' && env[k].length > 0);
console.log('PHASE5-VERIFY: present keys =', found.length, '/', expected.length, '— names:', found.join(','));
if (found.length === 0) {
  console.error('FAIL: no expected keys present — Infisical injection not working');
  globalThis['process'].exit(1);
}
