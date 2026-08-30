import { Prisma, Unit } from '@prisma/client';

/**
 * Units where a fractional result doesn't make sense (a countable thing —
 * cloves, slices, jars) vs. continuous units (weight/volume) that can carry
 * a decimal. See my-home-backend/CLAUDE.md's Servings scaling section for
 * the rounding rule this encodes.
 */
const COUNTABLE_UNITS: ReadonlySet<Unit> = new Set([
  Unit.GOUSSE,
  Unit.TRANCHE,
  Unit.SACHET,
  Unit.PAQUET,
  Unit.BOITE,
  Unit.POT,
  Unit.BOUTEILLE,
  Unit.TETE,
  Unit.DOUZAINE,
  Unit.MICHE,
  Unit.UNITE,
]);

/**
 * Scales a recipe quantity from one serving count to another. Countable
 * units round to the nearest whole number (never below 1 when the original
 * quantity was positive); continuous units round to 2 decimal places.
 * Decimal-safe throughout — never JS floats.
 */
export function scaleQuantity(
  quantity: Prisma.Decimal,
  unit: Unit,
  fromServings: number,
  toServings: number,
): Prisma.Decimal {
  if (fromServings === toServings) return quantity;

  const scaled = quantity.times(toServings).dividedBy(fromServings);

  if (COUNTABLE_UNITS.has(unit)) {
    const rounded = scaled.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    if (quantity.greaterThan(0) && rounded.lessThan(1)) {
      return new Prisma.Decimal(1);
    }
    return rounded;
  }

  return scaled.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
