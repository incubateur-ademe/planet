import { describe, expect, expectTypeOf, it } from 'vitest'
import { ESTIMATE_STATUSES, type ComputedStatus } from '../../domain/lever-registry.ts'
import {
  ESTIMATION_ERROR_KINDS,
  invalidRequest,
  levelNotComputed,
  SOLVE_ERROR_KINDS,
  type EstimationError,
  type EstimationErrorKind,
  type SolveError,
} from './estimation-error.ts'

describe('ESTIMATION_ERROR_KINDS', () => {
  it('liste les cinq kind d’EstimationError', () => {
    expect([...ESTIMATION_ERROR_KINDS].toSorted()).toEqual([
      'invalid_dataset',
      'invalid_request',
      'level_not_computed',
      'missing_data',
      'unknown_territory',
    ])
  })

  it('couvre exactement les kind du type EstimationError', () => {
    expectTypeOf<(typeof ESTIMATION_ERROR_KINDS)[number]>().toEqualTypeOf<EstimationError['kind']>()
    expectTypeOf<EstimationErrorKind>().toEqualTypeOf<EstimationError['kind']>()
  })

  it('contient le kind de chaque erreur construite par le paquet', () => {
    expect(ESTIMATION_ERROR_KINDS).toContain(invalidRequest([]).kind)
    expect(ESTIMATION_ERROR_KINDS).toContain(
      levelNotComputed({ lever: 'haies', level: 'region' }).kind,
    )
  })
})

describe('SOLVE_ERROR_KINDS', () => {
  it('ajoute deux kind à ceux d’EstimationError', () => {
    expect([...SOLVE_ERROR_KINDS].toSorted()).toEqual([
      'invalid_dataset',
      'invalid_request',
      'level_not_computed',
      'missing_data',
      'non_monotonic_parameter',
      'unknown_territory',
      'unreachable_target',
    ])
  })

  it('couvre exactement les kind du type SolveError', () => {
    expectTypeOf<(typeof SOLVE_ERROR_KINDS)[number]>().toEqualTypeOf<SolveError['kind']>()
  })
})

describe('ESTIMATE_STATUSES', () => {
  it('liste les deux statuts d’un niveau calculé', () => {
    expect(ESTIMATE_STATUSES).toEqual(['no_open_question', 'workaround'])
  })

  it('couvre exactement ComputedStatus', () => {
    expectTypeOf<(typeof ESTIMATE_STATUSES)[number]>().toEqualTypeOf<ComputedStatus>()
  })
})
