import { err, ok } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createDefaultEstimator } from '../create-default-estimator.ts'
import type { Estimate } from './estimate.ts'
import { createSolver } from './solve.ts'

const estimate = createDefaultEstimator()
const solve = createSolver(estimate)

const freightRequest = {
  id: 'transport_marchandises_sobriete_logistique',
  territory: { level: 'region', code: '84' },
  parameters: {},
}

function fakeEstimate(reductionOf: (value: number) => string) {
  return (request: unknown) => {
    const parameters = (request as { parameters: { x: string } }).parameters
    return ok({ reduction: reductionOf(Number(parameters.x)) } as Estimate)
  }
}

const wasteRequest = {
  id: 'dechets_mode_de_traitement',
  territory: { level: 'region', code: '84' },
  parameters: { storageToMaterialRecoveryFraction: '0.4', incinerationToMaterialRecoveryFraction: '0.1' },
}

function wasteWith(storageToIncinerationFraction: string) {
  return {
    ...wasteRequest,
    parameters: { ...wasteRequest.parameters, storageToIncinerationFraction },
  }
}

const dairyCows = {
  headcountReductionFraction: '0',
  targetManureShares: { liquid: '0.4', solid: '0.2', pasture: '0.4', anaerobicDigestion: '0' },
}

const livestockRequest = {
  id: 'elevage_durable',
  territory: { level: 'region', code: '84' },
  parameters: { animals: { dairyCows } },
}

function livestockWith(headcountReductionFraction: string) {
  return {
    ...livestockRequest,
    parameters: { animals: { dairyCows: { ...dairyCows, headcountReductionFraction } } },
  }
}

describe('solve', () => {
  describe('avec un paramètre imbriqué', () => {
    const path = 'animals.dairyCows.headcountReductionFraction'

    it('cherche la feuille désignée par le chemin', () => {
      const known = estimate(livestockWith('0.5'))._unsafeUnwrap().reduction

      const solution = solve(livestockRequest, path, known)._unsafeUnwrap()

      expect(solution.parameter).toBe(path)
      expect(solution.value).toBe('0.5')
      expect(solution.estimate.reduction).toBe(known)
    })

    it('cherche une baisse entérique facultative absente de la requête', () => {
      const withEnteric = {
        ...livestockRequest,
        parameters: {
          animals: { dairyCows: { ...dairyCows, entericEmissionReductionFraction: '0.2' } },
        },
      }
      const known = estimate(withEnteric)._unsafeUnwrap().reduction

      const solution = solve(livestockRequest, 'animals.dairyCows.entericEmissionReductionFraction', known)._unsafeUnwrap()

      expect(solution.value).toBe('0.2')
    })

    it('remonte l’erreur de l’estimateur quand l’animal n’est pas dans la requête', () => {
      const failure = solve(livestockRequest, 'animals.sheep.headcountReductionFraction', '1')._unsafeUnwrapErr()

      expect(failure).toMatchObject({
        kind: 'invalid_request',
        issues: [{ parameter: 'parameters.animals.sheep.targetManureShares', code: 'required' }],
      })
    })

    it('remplace un chemin qui traverse une valeur qui n’est pas un objet', () => {
      const failure = solve(
        { id: 'haies', parameters: { hedgeKmCreatedPerYear: '5' } },
        'hedgeKmCreatedPerYear.x',
        '1',
      )._unsafeUnwrapErr()

      expect(failure.kind).toBe('invalid_request')
    })
  })

  describe('avec des fractions liées', () => {
    it('cherche dans la place que laissent les autres paramètres', () => {
      const known = estimate(wasteWith('0.3'))._unsafeUnwrap().reduction

      const solution = solve(wasteRequest, 'storageToIncinerationFraction', known)._unsafeUnwrap()

      expect(solution.value).toBe('0.3')
      expect(solution.estimate.reduction).toBe(known)
    })

    it('renvoie la réduction au maximum admis quand la cible est plus haute', () => {
      const atMaximum = estimate(wasteWith('0.6'))._unsafeUnwrap().reduction

      const failure = solve(wasteRequest, 'storageToIncinerationFraction', '99999999')._unsafeUnwrapErr()

      expect(failure).toMatchObject({ kind: 'unreachable_target', maxReduction: atMaximum })
    })

    it('atteint la réduction du maximum admis', () => {
      const atMaximum = estimate(wasteWith('0.6'))._unsafeUnwrap().reduction

      const solution = solve(wasteRequest, 'storageToIncinerationFraction', atMaximum)._unsafeUnwrap()

      expect(solution.value).toBe('0.6')
    })
  })

  it('trouve le nombre de kilomètres de haies qui évite une réduction donnée', () => {
    const solution = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', '117')._unsafeUnwrap()

    expect(solution.parameter).toBe('hedgeKmCreatedPerYear')
    expect(solution.value).toBe('100')
    expect(solution.estimate.reduction).toBe('117')
  })

  it('accepte une cible numérique', () => {
    const solution = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', 11.7)._unsafeUnwrap()

    expect(solution.value).toBe('10')
  })

  it('trouve une fraction sur un levier territorial et renvoie la valeur la plus courte', () => {
    const solution = solve(freightRequest, 'roadFreightReductionFraction', '386488.05')._unsafeUnwrap()

    expect(solution.value).toBe('0.1')
    expect(solution.estimate.reduction).toBe('386488.05')
    expect(solution.estimate.datasets.length).toBeGreaterThan(0)
  })

  it('ignore la valeur déjà saisie pour le paramètre cherché', () => {
    const request = { id: 'haies', parameters: { hedgeKmCreatedPerYear: '999' } }

    expect(solve(request, 'hedgeKmCreatedPerYear', '117')._unsafeUnwrap().value).toBe('100')
  })

  it('renvoie zéro quand la cible est la réduction de base', () => {
    const solution = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', '0')._unsafeUnwrap()

    expect(solution.value).toBe('0')
  })

  it('refuse une cible au-delà du maximum d’un paramètre borné, et renvoie ce maximum', () => {
    const failure = solve(freightRequest, 'roadFreightReductionFraction', '99999999')._unsafeUnwrapErr()

    expect(failure).toEqual({
      kind: 'unreachable_target',
      parameter: 'roadFreightReductionFraction',
      minReduction: '0',
      maxReduction: '3864880.54',
    })
  })

  it('refuse une cible négative', () => {
    const failure = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', '-1')._unsafeUnwrapErr()

    expect(failure).toMatchObject({
      kind: 'invalid_request',
      issues: [{ parameter: 'targetReduction', code: 'out_of_range' }],
    })
  })

  it('refuse une cible qui n’est ni un texte ni un nombre', () => {
    const failure = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', {})._unsafeUnwrapErr()

    expect(failure).toMatchObject({
      kind: 'invalid_request',
      issues: [{ parameter: 'targetReduction', code: 'invalid_type' }],
    })
  })

  it('refuse une cible qui n’est pas un décimal', () => {
    const failure = solve({ id: 'haies', parameters: {} }, 'hedgeKmCreatedPerYear', 'beaucoup')._unsafeUnwrapErr()

    expect(failure).toMatchObject({
      kind: 'invalid_request',
      issues: [{ parameter: 'targetReduction', code: 'not_a_decimal' }],
    })
  })

  it('refuse un paramètre inconnu du levier', () => {
    const failure = solve({ id: 'haies', parameters: {} }, 'inconnu', '1')._unsafeUnwrapErr()

    expect(failure.kind === 'invalid_request' && failure.issues.map(({ code }) => code)).toContain('unknown_parameter')
  })

  it('remonte les paramètres obligatoires manquants du levier', () => {
    const failure = solve(
      { id: 'residentiel_sobriete', territory: { level: 'region', code: '84' }, parameters: {} },
      'householdsApplyingSobrietyFraction',
      '1',
    )._unsafeUnwrapErr()

    expect(failure).toMatchObject({
      kind: 'invalid_request',
      issues: [{ parameter: 'parameters.consumptionReductionFraction', code: 'required' }],
    })
  })

  it('refuse une requête qui n’est pas un objet', () => {
    const failure = solve('pas une requête', 'x', '1')._unsafeUnwrapErr()

    expect(failure).toMatchObject({ kind: 'invalid_request' })
  })

  it('refuse une requête dont les paramètres ne sont pas un objet', () => {
    const failure = solve({ id: 'haies', parameters: 'x' }, 'hedgeKmCreatedPerYear', '1')._unsafeUnwrapErr()

    expect(failure.kind).toBe('invalid_request')
  })

  it('remonte l’erreur de l’estimateur à une valeur de départ', () => {
    const failing = createSolver(() => err({ kind: 'missing_data', dataset: 'd', key: 'k' }))

    expect(failing({ parameters: {} }, 'x', '1')._unsafeUnwrapErr().kind).toBe('missing_data')
  })

  describe('avec un estimateur simulé', () => {
    const request = { parameters: {} }

    it('refuse un paramètre dont la réduction baisse', () => {
      const decreasing = createSolver(fakeEstimate((x) => String(0 - x)))

      expect(decreasing(request, 'x', '5')._unsafeUnwrapErr()).toEqual({
        kind: 'non_monotonic_parameter',
        parameter: 'x',
      })
    })

    it('cherche au-delà de 1 quand le paramètre n’a pas de borne haute', () => {
      const unbounded = createSolver(fakeEstimate((x) => String(x * 4)))

      expect(unbounded(request, 'x', '40')._unsafeUnwrap().value).toBe('10')
    })

    it('renvoie le maximum quand la réduction plafonne', () => {
      const capped = createSolver(fakeEstimate((x) => String(Math.min(x, 3))))

      expect(capped(request, 'x', '10')._unsafeUnwrapErr()).toEqual({
        kind: 'unreachable_target',
        parameter: 'x',
        minReduction: '0',
        maxReduction: '3',
      })
    })

    it('remonte une erreur de l’estimateur à une valeur plus haute', () => {
      const failingAboveOne = createSolver((request) => {
        const { x } = (request as { parameters: { x: string } }).parameters
        return Number(x) > 1
          ? err({ kind: 'missing_data', dataset: 'd', key: 'k' } as const)
          : ok({ reduction: x } as Estimate)
      })

      expect(failingAboveOne(request, 'x', '5')._unsafeUnwrapErr().kind).toBe('missing_data')
    })

    it('cherche sous la borne qu’impose un autre paramètre', () => {
      const sharingTheUnit = createSolver((request) => {
        const { x } = (request as { parameters: { x: string } }).parameters
        return Number(x) > 0.6
          ? err({
              kind: 'invalid_request',
              issues: [{ parameter: 'parameters.y', code: 'invalid_combination', message: 'must be at most 1' }],
            } as const)
          : ok({ reduction: String(Math.round(Number(x) * 1000) / 100) } as Estimate)
      })

      expect(sharingTheUnit(request, 'x', '5')._unsafeUnwrap().value).toBe('0.5')
      expect(sharingTheUnit(request, 'x', '7')._unsafeUnwrapErr()).toEqual({
        kind: 'unreachable_target',
        parameter: 'x',
        minReduction: '0',
        maxReduction: '6',
      })
    })

    it('refuse une cible en dessous de la réduction de base', () => {
      const offset = createSolver(fakeEstimate((x) => String(x + 5)))

      expect(offset(request, 'x', '2')._unsafeUnwrapErr()).toEqual({
        kind: 'unreachable_target',
        parameter: 'x',
        minReduction: '5',
        maxReduction: '6',
      })
    })

    it('refuse une réduction qui saute la cible', () => {
      const stepped = createSolver(fakeEstimate((x) => (x < 0.5 ? '0' : '10')))

      expect(stepped(request, 'x', '5')._unsafeUnwrapErr()).toEqual({
        kind: 'non_monotonic_parameter',
        parameter: 'x',
      })
    })

    it('écarte les arrondis que l’estimateur refuse', () => {
      const rejectingRoundedValues = (request: unknown) => {
        const { x } = (request as { parameters: { x: string } }).parameters
        return x === '0.3' || x === '0.31'
          ? err({ kind: 'invalid_request', issues: [] } as const)
          : ok({ reduction: (Number(x) * 10).toFixed(2) } as Estimate)
      }

      expect(createSolver(rejectingRoundedValues)(request, 'x', '3.14')._unsafeUnwrap().value).toBe('0.314')
    })

    it('arrondit la cible comme une réduction', () => {
      const linear = createSolver(fakeEstimate((x) => (x * 2).toFixed(2)))

      expect(linear(request, 'x', '1.005')._unsafeUnwrap().estimate.reduction).toBe('1.01')
    })
  })
})
