import { Prisma, Unit } from '@prisma/client';

import { scaleQuantity } from './quantity-scaling';

describe('scaleQuantity', () => {
  it('returns the input unchanged when servings are equal', () => {
    const quantity = new Prisma.Decimal('250');
    expect(scaleQuantity(quantity, Unit.G, 4, 4)).toBe(quantity);
  });

  describe('continuous units', () => {
    it('scales and rounds to 2 decimal places', () => {
      const result = scaleQuantity(new Prisma.Decimal('250'), Unit.G, 4, 3);
      expect(result.toString()).toBe('187.5');
    });

    it('rounds a repeating decimal to 2 places', () => {
      const result = scaleQuantity(new Prisma.Decimal('100'), Unit.ML, 3, 1);
      expect(result.toString()).toBe('33.33');
    });

    it('scales up cleanly', () => {
      const result = scaleQuantity(new Prisma.Decimal('1.5'), Unit.L, 4, 8);
      expect(result.toString()).toBe('3');
    });
  });

  describe('countable units', () => {
    it('rounds to the nearest whole number', () => {
      const result = scaleQuantity(new Prisma.Decimal('3'), Unit.UNITE, 4, 3);
      // 3 * 3/4 = 2.25 -> 2
      expect(result.toString()).toBe('2');
    });

    it('rounds half up', () => {
      const result = scaleQuantity(new Prisma.Decimal('1'), Unit.GOUSSE, 2, 3);
      // 1 * 3/2 = 1.5 -> 2
      expect(result.toString()).toBe('2');
    });

    it('never rounds a positive quantity down to 0', () => {
      const result = scaleQuantity(new Prisma.Decimal('1'), Unit.UNITE, 8, 1);
      // 1 * 1/8 = 0.125 -> floored at 1, not 0
      expect(result.toString()).toBe('1');
    });

    it('leaves a zero quantity at zero', () => {
      const result = scaleQuantity(new Prisma.Decimal('0'), Unit.UNITE, 8, 1);
      expect(result.toString()).toBe('0');
    });
  });
});
