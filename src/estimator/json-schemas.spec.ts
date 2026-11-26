import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { createDefaultEstimator } from '../create-default-estimator.ts'
import { levels } from '../domain/territory.ts'
import type { Estimate } from './estimate.ts'
import {
  ESTIMATE_REQUEST_JSON_SCHEMA,
  ESTIMATE_RESPONSE_JSON_SCHEMA,
  SOLUTION_JSON_SCHEMA,
  SOLVE_REQUEST_JSON_SCHEMA,
} from './json-schemas.ts'
import { LEVERS_CATALOG } from './levers-catalog.ts'
import type { estimateResponseSchema, solutionSchema } from './response-schemas.ts'
import { createSolver, type Solution } from './solve.ts'

const DIALECT = 'https://json-schema.org/draft/2020-12/schema'

const estimate = createDefaultEstimator()
const solve = createSolver(estimate)

const territory = { level: 'region', code: '84' }
const FRACTION = '0.1'

type Fixture = { readonly request: Record<string, unknown>; readonly solveFor: string }

function fixture(id: string, parameters: object, solveFor: string, withTerritory = true): Fixture {
  return { request: { id, ...(withTerritory ? { territory } : {}), parameters }, solveFor }
}

const FIXTURES: Readonly<Record<string, Fixture>> = {
  batiments_machines_agricoles: fixture(
    'batiments_machines_agricoles',
    {
      electricityReductionFraction: FRACTION,
      naturalGasReductionFraction: FRACTION,
      petroleumProductsReductionFraction: FRACTION,
      heatReductionFraction: FRACTION,
    },
    'petroleumProductsReductionFraction',
  ),
  dechets_mode_de_traitement: fixture(
    'dechets_mode_de_traitement',
    {
      storageToIncinerationFraction: FRACTION,
      storageToMaterialRecoveryFraction: FRACTION,
      incinerationToMaterialRecoveryFraction: FRACTION,
    },
    'storageToIncinerationFraction',
  ),
  dechets_sobriete: fixture(
    'dechets_sobriete',
    { storageReductionFraction: FRACTION, incinerationReductionFraction: FRACTION },
    'storageReductionFraction',
  ),
  elevage_durable: fixture(
    'elevage_durable',
    {
      animals: {
        dairyCows: {
          headcountReductionFraction: FRACTION,
          targetManureShares: { liquid: '0.4', solid: '0.2', pasture: '0.4', anaerobicDigestion: '0' },
        },
      },
    },
    'animals.dairyCows.headcountReductionFraction',
  ),
  fertilisation_azotee: fixture(
    'fertilisation_azotee',
    { nitrogenReductionFraction: FRACTION },
    'nitrogenReductionFraction',
  ),
  haies: fixture('haies', { hedgeKmCreatedPerYear: '10' }, 'hedgeKmCreatedPerYear', false),
  occupation_des_sols: fixture(
    'occupation_des_sols',
    {
      afforestationHectaresPerYear: '10',
      wetlandDevelopmentHectaresPerYear: '10',
      desealingHectaresPerYear: '10',
      horizonYears: '10',
    },
    'afforestationHectaresPerYear',
  ),
  pratiques_stockantes: fixture(
    'pratiques_stockantes',
    {
      intermediateCropsHectares: '10',
      permanentVineyardGrassingHectares: '10',
      winterIntercropVineyardHectares: '10',
      agroforestryHectares: '10',
      temporaryGrasslandExtensionHectares: '10',
    },
    'intermediateCropsHectares',
    false,
  ),
  produits_bois: fixture('produits_bois', { woodProductionIncrease: FRACTION }, 'woodProductionIncrease'),
  reseaux_chaleur: fixture(
    'reseaux_chaleur',
    { emissionFactorReductionFraction: FRACTION },
    'emissionFactorReductionFraction',
  ),
  residentiel_changement_systeme_chauffage: fixture(
    'residentiel_changement_systeme_chauffage',
    { targetElectricityShareFraction: '0.3' },
    'targetElectricityShareFraction',
  ),
  residentiel_renovation: fixture(
    'residentiel_renovation',
    { renovatedParcFraction: FRACTION },
    'renovatedParcFraction',
  ),
  residentiel_sobriete: fixture(
    'residentiel_sobriete',
    { householdsApplyingSobrietyFraction: FRACTION, consumptionReductionFraction: FRACTION },
    'householdsApplyingSobrietyFraction',
  ),
  transport_marchandises_efficacite: fixture(
    'transport_marchandises_efficacite',
    { ecodrivingApplicationFraction: FRACTION, loadFactorIncrease: FRACTION },
    'ecodrivingApplicationFraction',
  ),
  transport_marchandises_electrification: fixture(
    'transport_marchandises_electrification',
    { additionalElectrifiedFleetFraction: FRACTION },
    'additionalElectrifiedFleetFraction',
  ),
  transport_marchandises_report_modal: fixture(
    'transport_marchandises_report_modal',
    { roadToRailFraction: FRACTION, roadToWaterwayFraction: '0.05' },
    'roadToRailFraction',
  ),
  transport_marchandises_sobriete_logistique: fixture(
    'transport_marchandises_sobriete_logistique',
    { roadFreightReductionFraction: FRACTION },
    'roadFreightReductionFraction',
  ),
  transport_personnes_efficacite: fixture(
    'transport_personnes_efficacite',
    {
      carEcodrivingApplicationFraction: FRACTION,
      busEcodrivingApplicationFraction: FRACTION,
      carPassengerIncrease: FRACTION,
      busPassengerIncrease: FRACTION,
    },
    'carEcodrivingApplicationFraction',
  ),
  transport_personnes_electrification: fixture(
    'transport_personnes_electrification',
    { carElectrificationFraction: FRACTION, busElectrificationFraction: FRACTION },
    'carElectrificationFraction',
  ),
  transport_personnes_report_modal: fixture(
    'transport_personnes_report_modal',
    {
      carToPublicTransportFraction: FRACTION,
      carToActiveModesFraction: FRACTION,
      publicTransportToActiveModesFraction: FRACTION,
    },
    'carToPublicTransportFraction',
  ),
  transport_personnes_sobriete_deplacements: fixture(
    'transport_personnes_sobriete_deplacements',
    { commutingDistanceReductionFraction: FRACTION },
    'commutingDistanceReductionFraction',
  ),
}

const ajv = new Ajv2020()
const validateEstimateRequest = ajv.compile(ESTIMATE_REQUEST_JSON_SCHEMA)
const validateSolveRequest = ajv.compile(SOLVE_REQUEST_JSON_SCHEMA)
const validateEstimateResponse = ajv.compile(ESTIMATE_RESPONSE_JSON_SCHEMA)
const validateSolution = ajv.compile(SOLUTION_JSON_SCHEMA)

function estimateOf(leverId: string): Estimate {
  const { request } = FIXTURES[leverId] ?? fail(`fixture manquante : ${leverId}`)
  return estimate(request)._unsafeUnwrap()
}

function solutionOf(leverId: string): Solution {
  const { request, solveFor } = FIXTURES[leverId] ?? fail(`fixture manquante : ${leverId}`)
  return solve({ request, solveFor, targetReductionTco2e: estimateOf(leverId).reduction })._unsafeUnwrap()
}

function fail(message: string): never {
  throw new Error(message)
}

describe('JSON Schema exportés', () => {
  it.each([
    ['ESTIMATE_REQUEST_JSON_SCHEMA', ESTIMATE_REQUEST_JSON_SCHEMA],
    ['SOLVE_REQUEST_JSON_SCHEMA', SOLVE_REQUEST_JSON_SCHEMA],
    ['ESTIMATE_RESPONSE_JSON_SCHEMA', ESTIMATE_RESPONSE_JSON_SCHEMA],
    ['SOLUTION_JSON_SCHEMA', SOLUTION_JSON_SCHEMA],
  ])('%s est un JSON Schema 2020-12 valide, autonome et gelé', (_name, schema) => {
    const text = JSON.stringify(schema)

    expect(schema['$schema']).toBe(DIALECT)
    expect(text.split('"$schema"')).toHaveLength(2)
    expect(text).not.toContain('"$ref"')
    expect(ajv.validateSchema(schema)).toBe(true)
    expect(Object.isFrozen(schema)).toBe(true)
  })

  it('la fixture de chaque levier du catalogue existe, et seulement elles', () => {
    expect(Object.keys(FIXTURES).toSorted()).toEqual(LEVERS_CATALOG.map(({ id }) => id).toSorted())
  })

  describe('ESTIMATE_REQUEST_JSON_SCHEMA', () => {
    it.each(LEVERS_CATALOG.map(({ id }) => id))('accepte la requête valide de %s', (id) => {
      const { request } = FIXTURES[id] ?? fail(`fixture manquante : ${id}`)

      expect(validateEstimateRequest(request), JSON.stringify(validateEstimateRequest.errors)).toBe(true)
    })

    it('refuse un levier inconnu', () => {
      expect(validateEstimateRequest({ id: 'inconnu', territory, parameters: {} })).toBe(false)
    })

    it('refuse un paramètre inconnu', () => {
      const { request } = FIXTURES['haies'] ?? fail('fixture manquante : haies')

      expect(validateEstimateRequest({ ...request, parameters: { hedgeKmCreatedPerYear: '10', inconnu: '1' } })).toBe(false)
    })

    it('refuse un paramètre obligatoire manquant', () => {
      expect(validateEstimateRequest({ id: 'residentiel_renovation', territory, parameters: {} })).toBe(false)
    })

    it('refuse un territoire pour un levier qui n’en prend pas', () => {
      expect(validateEstimateRequest({ id: 'haies', territory, parameters: { hedgeKmCreatedPerYear: '10' } })).toBe(false)
    })

    it('exige un territoire pour un levier qui en prend un', () => {
      expect(validateEstimateRequest({ id: 'residentiel_renovation', parameters: { renovatedParcFraction: '0.1' } })).toBe(false)
    })

    it.each(levels)('accepte le niveau %s', (level) => {
      const request = { id: 'residentiel_renovation', territory: { level, code: '84' }, parameters: { renovatedParcFraction: '0.1' } }

      expect(validateEstimateRequest(request)).toBe(true)
    })

    it('refuse un niveau inconnu et un code vide', () => {
      const parameters = { renovatedParcFraction: '0.1' }

      expect(validateEstimateRequest({ id: 'residentiel_renovation', territory: { level: 'commune', code: '84' }, parameters })).toBe(false)
      expect(validateEstimateRequest({ id: 'residentiel_renovation', territory: { level: 'region', code: '' }, parameters })).toBe(false)
    })

    it('accepte une valeur décimale en nombre et refuse un texte qui n’en est pas un', () => {
      const request = (value: unknown) => ({ id: 'residentiel_renovation', territory, parameters: { renovatedParcFraction: value } })

      expect(validateEstimateRequest(request(0.1))).toBe(true)
      expect(validateEstimateRequest(request('abc'))).toBe(false)
    })
  })

  describe('SOLVE_REQUEST_JSON_SCHEMA', () => {
    it.each(LEVERS_CATALOG.map(({ id }) => id))('accepte l’entrée de solve de %s', (id) => {
      const { request, solveFor } = FIXTURES[id] ?? fail(`fixture manquante : ${id}`)
      const input = { request, solveFor, targetReductionTco2e: estimateOf(id).reduction }

      expect(validateSolveRequest(input), JSON.stringify(validateSolveRequest.errors)).toBe(true)
    })

    it('limite solveFor aux paramètres cherchables du levier', () => {
      const { request } = FIXTURES['residentiel_sobriete'] ?? fail('fixture manquante : residentiel_sobriete')

      expect(validateSolveRequest({ request, solveFor: 'consumptionReductionFraction', targetReductionTco2e: '1' })).toBe(true)
      expect(validateSolveRequest({ request, solveFor: 'horizonYears', targetReductionTco2e: '1' })).toBe(false)
    })

    it('n’exige pas le paramètre qui est l’inconnue', () => {
      const request = { id: 'residentiel_renovation', territory, parameters: {} }

      expect(validateSolveRequest({ request, solveFor: 'renovatedParcFraction', targetReductionTco2e: '1' })).toBe(true)
    })

    it('accepte une cible en nombre et refuse un texte qui n’est pas un décimal', () => {
      const { request, solveFor } = FIXTURES['haies'] ?? fail('fixture manquante : haies')

      expect(validateSolveRequest({ request, solveFor, targetReductionTco2e: 117 })).toBe(true)
      expect(validateSolveRequest({ request, solveFor, targetReductionTco2e: 'beaucoup' })).toBe(false)
    })

    it('refuse un levier inconnu, une clé inconnue et une entrée incomplète', () => {
      const { request, solveFor } = FIXTURES['haies'] ?? fail('fixture manquante : haies')

      expect(validateSolveRequest({ request: { id: 'inconnu', parameters: {} }, solveFor, targetReductionTco2e: '1' })).toBe(false)
      expect(validateSolveRequest({ request, solveFor, targetReductionTco2e: '1', autre: 1 })).toBe(false)
      expect(validateSolveRequest({ request, solveFor })).toBe(false)
    })
  })

  describe('réponses réelles', () => {
    it.each(LEVERS_CATALOG.map(({ id }) => id))('l’estimation de %s valide ESTIMATE_RESPONSE_JSON_SCHEMA', (id) => {
      const result = estimateOf(id)

      expect(validateEstimateResponse(result), JSON.stringify(validateEstimateResponse.errors)).toBe(true)
    })

    it.each(LEVERS_CATALOG.map(({ id }) => id))('la solution de %s valide SOLUTION_JSON_SCHEMA', (id) => {
      const result = solutionOf(id)

      expect(validateSolution(result), JSON.stringify(validateSolution.errors)).toBe(true)
    })

    it.each(LEVERS_CATALOG.map(({ id }) => id))('l’estimation et la solution de %s sont gelées et sérialisables telles quelles', (id) => {
      const estimation = estimateOf(id)
      const solution = solutionOf(id)

      expect(Object.isFrozen(estimation)).toBe(true)
      expect(Object.isFrozen(solution)).toBe(true)
      expect(JSON.parse(JSON.stringify(estimation))).toEqual(estimation)
      expect(JSON.parse(JSON.stringify(solution))).toEqual(solution)
    })

    it('refuse une réponse dont la réduction n’est pas un texte décimal', () => {
      expect(validateEstimateResponse({ ...estimateOf('haies'), reduction: 11.7 })).toBe(false)
      expect(validateEstimateResponse({ ...estimateOf('haies'), reduction: '1e3' })).toBe(false)
    })

    it('refuse une réponse avec un champ en trop ou un statut inconnu', () => {
      expect(validateEstimateResponse({ ...estimateOf('haies'), extra: 1 })).toBe(false)
      expect(validateEstimateResponse({ ...estimateOf('haies'), status: 'not_computed' })).toBe(false)
    })
  })

  describe('schémas zod internes', () => {
    it('produisent des valeurs qui sont des Estimate et des Solution', () => {
      expectTypeOf<z.output<typeof estimateResponseSchema>>().toExtend<Estimate>()
      expectTypeOf<z.output<typeof solutionSchema>>().toExtend<Solution>()
    })
  })
})
