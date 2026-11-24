import { Injectable } from '@nestjs/common';
import type {
  DietaryPreference,
  EntitlementConfiguration,
  PoolConversionRecord,
} from '../repositories/entitlement-config.repository';
import { scaleByDays, toNumber } from './entitlement-math';

/**
 * Cross-pool conversion.
 *
 * Two shapes, both read from `rik.pool_conversions`:
 *
 *   AUTOMATIC — the source pool does not apply to this dietary
 *               preference, so its entitlement arrives in the target
 *               pool with no choice to make. A pure-veg officer's egg
 *               and meat entitlements arrive as milk this way.
 *
 *   ELECTIVE  — the customer may decline the source entitlement and take
 *               the target instead. Electing one zeroes the source pool's
 *               own contribution, so an entitlement can never be spent
 *               twice.
 *
 * There is no dietary logic in this file. Which conversions apply is
 * decided by matching the configured `dietary_preference` column, and a
 * NULL there means "every dietary preference".
 */

export interface ConversionEffect {
  conversionId: string;
  code: string;
  mode: 'AUTOMATIC' | 'ELECTIVE';
  fromPoolId: string;
  toPoolId: string;
  /** Daily quantity surrendered in the source pool's unit. */
  fromDailyQty: number;
  /** Daily quantity gained in the target pool's unit. */
  toDailyQty: number;
  /** Total gained over the period, in the target pool's unit. */
  toTotalQty: number;
  description: string | null;
  displayOrder: number;
}

@Injectable()
export class RikConversionService {
  /** Conversions whose configured dietary scope covers this preference. */
  applicableConversions(
    config: EntitlementConfiguration,
    dietaryPreference: DietaryPreference,
    mode: 'AUTOMATIC' | 'ELECTIVE'
  ): PoolConversionRecord[] {
    return config.conversions.filter(
      (c) =>
        c.mode === mode &&
        (c.dietary_preference === null || c.dietary_preference === dietaryPreference)
    );
  }

  /** Turn a configured conversion row into its effect over a period. */
  toEffect(conversion: PoolConversionRecord, eligibleDays: number): ConversionEffect {
    const fromDailyQty = toNumber(conversion.from_qty);
    const toDailyQty = toNumber(conversion.to_qty);
    return {
      conversionId: conversion.id,
      code: conversion.code,
      mode: conversion.mode,
      fromPoolId: conversion.from_pool_id,
      toPoolId: conversion.to_pool_id,
      fromDailyQty,
      toDailyQty,
      toTotalQty: scaleByDays(toDailyQty, eligibleDays),
      description: conversion.description,
      displayOrder: conversion.display_order,
    };
  }

  /**
   * Every AUTOMATIC effect for this preference. These need no customer
   * decision, so they are always part of the entitlement.
   */
  automaticEffects(
    config: EntitlementConfiguration,
    dietaryPreference: DietaryPreference,
    eligibleDays: number
  ): ConversionEffect[] {
    return this.applicableConversions(config, dietaryPreference, 'AUTOMATIC').map((c) =>
      this.toEffect(c, eligibleDays)
    );
  }

  /** Every ELECTIVE option for this preference, whether or not it was taken. */
  electiveOptions(
    config: EntitlementConfiguration,
    dietaryPreference: DietaryPreference,
    eligibleDays: number
  ): ConversionEffect[] {
    return this.applicableConversions(config, dietaryPreference, 'ELECTIVE').map((c) =>
      this.toEffect(c, eligibleDays)
    );
  }

  /**
   * Elective conversions the customer actually took.
   *
   * An id that is not a valid elective option for this preference is
   * dropped rather than trusted — the request never decides what is
   * allowed.
   */
  selectedEffects(
    options: ConversionEffect[],
    selectedConversionIds: readonly string[]
  ): ConversionEffect[] {
    const wanted = new Set(selectedConversionIds);
    return options.filter((o) => wanted.has(o.conversionId));
  }

  /**
   * Two elections that surrender the SAME source pool conflict: the meat
   * entitlement cannot be taken as eggs and as milk at once.
   */
  findConflictingElections(effects: readonly ConversionEffect[]): ConversionEffect[][] {
    const bySource = new Map<string, ConversionEffect[]>();
    for (const effect of effects) {
      const list = bySource.get(effect.fromPoolId) ?? [];
      list.push(effect);
      bySource.set(effect.fromPoolId, list);
    }
    return [...bySource.values()].filter((group) => group.length > 1);
  }
}
