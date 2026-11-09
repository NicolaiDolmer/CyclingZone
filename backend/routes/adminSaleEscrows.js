// #6181 / #7871 · Laaste salg (sale_escrows) for admin.
//
// GET  /           de holdte escrows og hvad heal-sweepet ville goere med dem
//                  (release/refund/wait/stuck).
// POST /:id/resolve  den manuelle vej for et bytte, der sidder fast (een rytter
//                  leveret, den anden mistet): outcome "release" krediterer
//                  modtageren, "refund" giver betaleren beloebet tilbage. Ingen
//                  rytter flyttes. resolve_stuck_sale_escrow goer det i een
//                  transaktion og afviser selv alt, der ikke sidder fast.
//
// Egen router (som adminRoadmap.js), saa api.js kun faar monteringen.
import express from 'express';
import { listHeldSaleEscrowsForAdmin, resolveStuckSaleEscrow } from '../lib/saleEscrowFlow6181.js';
import { ADMIN_ACTION_TYPE } from '../lib/economyConstants.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASS = (_req, _res, next) => next();

export function createAdminSaleEscrowsRouter({
  supabase,
  requireAdmin,
  writeLimiter = PASS,
  captureExceptionFn = () => {},
  list = listHeldSaleEscrowsForAdmin,
  resolve = resolveStuckSaleEscrow,
}) {
  if (typeof requireAdmin !== 'function') throw new TypeError('requireAdmin is required');
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', async (req, res) => {
    try {
      return res.json({ escrows: await list(supabase) });
    } catch (error) {
      captureExceptionFn(error, { tags: { source: 'admin-sale-escrows', route: 'list' } });
      return res.status(500).json({ error: 'Sale escrow request failed' });
    }
  });

  router.post('/:id/resolve', writeLimiter, async (req, res) => {
    const { id } = req.params;
    const { outcome, reason } = req.body || {};
    if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid sale escrow id' });
    if (outcome !== 'release' && outcome !== 'refund') {
      return res.status(400).json({ error: 'outcome must be release or refund' });
    }
    const note = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
    try {
      const result = await resolve(supabase, { escrowId: id, outcome, adminUserId: req.user?.id ?? null });
      if (result?.status === 'missing') return res.status(404).json({ error: 'Sale escrow not found', result });
      if (result?.status !== 'released' && result?.status !== 'refunded') {
        return res.status(409).json({ error: `This sale escrow cannot be resolved manually (${result?.status ?? 'unknown'})`, result });
      }
      // Pengene er flyttet; en fejlet log maa ikke ligne en fejlet afgoerelse.
      const { error: logError } = await supabase.from('admin_log').insert({
        admin_user_id: req.user?.id ?? null,
        action_type: ADMIN_ACTION_TYPE.MANUAL_OVERRIDE,
        description: `Sale escrow ${id} resolved manually: ${outcome}${note ? ` (${note})` : ''}`,
        meta: { sale_escrow_id: id, outcome, result, reason: note },
      });
      if (logError) captureExceptionFn(logError, { tags: { source: 'admin-sale-escrows', route: 'resolve-log' } });
      return res.json({ success: true, result });
    } catch (error) {
      captureExceptionFn(error, { tags: { source: 'admin-sale-escrows', route: 'resolve' } });
      return res.status(500).json({ error: 'Sale escrow request failed' });
    }
  });

  return router;
}
