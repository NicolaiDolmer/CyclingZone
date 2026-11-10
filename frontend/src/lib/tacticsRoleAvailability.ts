import { baseRoleForRider } from './raceIntention.js';

type Rider = { race_role?: unknown };
export function tacticsRoleAvailability(context: unknown, riders: readonly Rider[]) {
  if (context !== null && typeof context === 'object' && Object.hasOwn(context, 'special_roles_allowed')) {
    const allowed = (context as {special_roles_allowed:unknown}).special_roles_allowed === true;
    return { coCaptainOn: allowed, luxuryHelperOn: allowed };
  }
  // Rolling frontend-before-backend deployment: retain the previous per-role fallback.
  return {
    coCaptainOn: riders.some(rider=>baseRoleForRider(rider)==='co_captain'),
    luxuryHelperOn: riders.some(rider=>baseRoleForRider(rider)==='luxury_helper'),
  };
}
