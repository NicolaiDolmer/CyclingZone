import express from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['active', 'planned', 'in_progress', 'shipped', 'archived']);
const HORIZONS = new Set(['next', 'later']);
const PASS = (_req, _res, next) => next();

export function createAdminRoadmapRouter({ supabase, requireAdmin, writeLimiter = PASS, captureExceptionFn = () => {} }) {
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
  router.post('/resync', writeLimiter, (req, res) => call(req, res, 'roadmap_resync_flags', undefined, data => ({ updated: data })));
  router.post('/split', writeLimiter, (req, res) => {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body.source !== 'string' || !UUID.test(body.source)
      || typeof body.title_en !== 'string' || !body.title_en.trim()
      || typeof body.title_da !== 'string' || !body.title_da.trim()
      || !STATUSES.has(body.status ?? 'planned') || !HORIZONS.has(body.horizon ?? 'next')
      || (body.issue_ref != null && (!Number.isSafeInteger(body.issue_ref) || body.issue_ref <= 0))) {
      return res.status(400).json({ error: 'Invalid roadmap split' });
    }
    return call(req, res, 'roadmap_split_item', {
      p_source: body.source, p_title_en: body.title_en.trim(), p_title_da: body.title_da.trim(),
      p_status: body.status ?? 'planned', p_horizon: body.horizon ?? 'next', p_issue_ref: body.issue_ref ?? null,
    }, data => ({ id: data }));
  });
  return router;
}
