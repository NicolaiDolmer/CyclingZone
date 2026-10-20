// #6839: additive manager RPCs deploy after the backend (auto-migrate delay).
// Only an absent wrapper may fall back to the original blocking operation.
// Never retry a real failure or a held result: either could hide concurrency.
export async function trainingDateRpc(supabase, name, args, nonBlocking = false) {
  if (!nonBlocking) return supabase.rpc(name, args);
  const wrapper = `try_${name}`;
  const result = await supabase.rpc(wrapper, args);
  if (result.error?.code === 'PGRST202' && result.error.message?.includes(`public.${wrapper}`)) {
    return supabase.rpc(name, args);
  }
  return result;
}
