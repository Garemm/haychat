/**
 * src/routes/businessRoutes.js
 *
 * REST endpoints for business (tenant) data.
 * Used by the frontend BusinessSelector to list available tenants.
 */
const { Router } = require('express');
const BusinessModel = require('../models/businessModel');

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

module.exports = router;
