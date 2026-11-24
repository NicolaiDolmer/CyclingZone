import express from 'express';
import { runRoadmapDeliveredNotify } from '../lib/roadmapDeliveredNotify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['active', 'planned', 'in_progress', 'shipped', 'archived']);
const DEFAULT_HORIZON = 'unscheduled';

function validHorizon(value) {
  if (typeof value !== 'string') return false;
  if (/^(unscheduled|season_[1-9]\d?(_start)?|q[1-4]_20\d{2})$/.test(value)) return true;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  const week = /^(20\d{2})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value);
  if (!week) return false;
  // Only an ISO year with 53 weeks has December 28 in week 53.
  if (week[2] !== '53') return true;
  const year = Number(week[1]);
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return jan1 === 4 || (jan1 === 3 && leap);
}

const PASS = (_req, _res, next) => next();

export function createAdminRoadmapRouter({ supabase, requireAdmin, writeLimiter = PASS, captureExceptionFn = () => {}, runDelivered = runRoadmapDeliveredNotify }) {
  if (typeof requireAdmin !== 'function') throw new TypeError('requireAdmin is required');
  const router = express.Router();
  router.use(requireAdmin);

  async function call(req, res, name, args, render) {
    try {
      const { data, error } = args === undefined ? await supabase.rpc(name) : await supabase.rpc(name, args);
      if (error) throw error;
      return res.json(render(data));
    } catch (error) {
      captureExceptionFn(error, { tags: { source: 'admin-roadmap', rpc: name } });
      return res.status(500).json({ error: 'Roadmap request failed' });
    }
  }

  router.get('/stats', (req, res) => call(req, res, 'roadmap_admin_stats', undefined, data => ({ stats: data?.[0] ?? null })));
  // #7789: grafens filtre (aktive managere, division). Ingen user_id i svaret, se migrationen.
  router.get('/votes', (req, res) => call(req, res, 'roadmap_admin_vote_rows', undefined, data => ({ votes: data ?? null })));
  router.post('/resync', writeLimiter, (req, res) => call(req, res, 'roadmap_resync_flags', undefined, data => ({ updated: data })));
  // #7792: kør leveret-sweepet nu (cron'en tager det ellers inden for få minutter).
  router.post('/notify-delivered', writeLimiter, async (req, res) => {
    try { return res.json(await runDelivered({ supabase })); } catch (error) {
      captureExceptionFn(error, { tags: { source: 'admin-roadmap', route: 'notify-delivered' } });
      return res.status(500).json({ error: 'Roadmap request failed' });
    }
  });
  router.post('/split', writeLimiter, (req, res) => {
    const body = req.body;
    const status = body?.status ?? "active";
    const horizon = body?.horizon ?? DEFAULT_HORIZON;
    const issue = body?.issue_ref ?? null;
    if (!body || Array.isArray(body) || typeof body.source !== 'string' || !UUID.test(body.source)
      || typeof body.title_en !== 'string' || !body.title_en.trim()
      || typeof body.title_da !== 'string' || !body.title_da.trim()
      || !STATUSES.has(status) || !validHorizon(horizon)
      || (issue !== null && (!Number.isInteger(issue) || issue <= 0 || issue > 2_147_483_647))
      || (status === 'planned' && (issue === null || horizon === DEFAULT_HORIZON))) {
      return res.status(400).json({ error: 'Invalid roadmap split' });
    }
    return call(req, res, 'roadmap_split_item', {
      p_source: body.source, p_title_en: body.title_en.trim(), p_title_da: body.title_da.trim(),
      p_status: status, p_horizon: horizon, p_issue_ref: issue,
    }, data => ({ id: data }));
  });
  return router;
}
