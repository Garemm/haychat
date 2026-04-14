/**
 * src/routes/businessRoutes.js
 *
 * REST endpoints for business (tenant) data.
 * Used by the frontend BusinessSelector to list available tenants.
 */
import { Router } from 'express';
import BusinessModel from '../models/businessModel.js';

const router = Router();

// GET /api/business — Returns all registered businesses
router.get('/', async (req, res, next) => {
  try {
    const businesses = await BusinessModel.getAllBusinesses();
    res.json({ success: true, data: businesses });
  } catch (err) {
    next(err);
  }
});

// GET /api/business/by-uuid/:chatUuid — Resolves a public chat UUID to business info
router.get('/by-uuid/:chatUuid', async (req, res, next) => {
  try {
    const business = await BusinessModel.getByUuid(req.params.chatUuid);
    if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
    res.json({ success: true, data: business });
  } catch (err) {
    next(err);
  }
});

export default router;
