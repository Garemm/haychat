jest.mock('../../src/models/businessModel');

import BusinessModel from '../../src/models/businessModel.js';
import { getBusinessInfoByIntent } from '../../src/services/businessInfoService.js';

const BUSINESS_ID = 1;

// ─── Per-intent routing ───────────────────────────────────────────────────────

describe('getBusinessInfoByIntent() — QUERY_MAP routing', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const INTENTS = [
    ['horarios',    'getHorarios'],
    ['productos',   'getProductos'],
    ['precios',     'getPrecios'],
    ['promociones', 'getPromociones'],
    ['ubicacion',   'getUbicacion'],
  ];

  test.each(INTENTS)(
    'intent "%s" calls BusinessModel.%s with businessId',
    async (intent, method) => {
      const fakeRows = [{ id: 1, sample: 'data' }];
      BusinessModel[method].mockResolvedValueOnce(fakeRows);

      const result = await getBusinessInfoByIntent(intent, BUSINESS_ID);

      expect(BusinessModel[method]).toHaveBeenCalledTimes(1);
      expect(BusinessModel[method]).toHaveBeenCalledWith(BUSINESS_ID);
      expect(result).toBe(fakeRows);
    }
  );

  test.each(INTENTS)(
    'intent "%s" does NOT call any other model method',
    async (intent, calledMethod) => {
      BusinessModel[calledMethod].mockResolvedValueOnce([]);

      await getBusinessInfoByIntent(intent, BUSINESS_ID);

      // Ensure every OTHER method was not called
      for (const [, otherMethod] of INTENTS) {
        if (otherMethod !== calledMethod) {
          expect(BusinessModel[otherMethod]).not.toHaveBeenCalled();
        }
      }
    }
  );
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('getBusinessInfoByIntent() — error handling', () => {
  test('throws for an unknown intent key', async () => {
    await expect(
      getBusinessInfoByIntent('fake_intent', BUSINESS_ID)
    ).rejects.toThrow('fake_intent');
  });

  test('propagates DB errors from model methods', async () => {
    BusinessModel.getHorarios.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(
      getBusinessInfoByIntent('horarios', BUSINESS_ID)
    ).rejects.toThrow('DB timeout');
  });

  test('returns empty array when model resolves with empty array', async () => {
    BusinessModel.getProductos.mockResolvedValueOnce([]);

    const result = await getBusinessInfoByIntent('productos', BUSINESS_ID);

    expect(result).toEqual([]);
  });
});
