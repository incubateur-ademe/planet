import { z } from 'zod'
import { decimalInputSchema, territorySchema } from '../application/estimate/shared-schemas.ts'
import { LEVERS_CATALOG, type JsonSchema, type LeverCatalogEntry } from './levers-catalog.ts'
import { requestSchema } from './parse-request.ts'
import { estimateResponseSchema, solutionSchema } from './response-schemas.ts'

// Source : choix de conception, non validé : les schémas d'entrée décrivent la requête avant transformation (io: input), ceux de sortie la valeur renvoyée (io: output)
const INPUT_OPTIONS = { io: 'input', unrepresentable: 'any' } as const

// Source : choix de conception, non validé : voir INPUT_OPTIONS
const OUTPUT_OPTIONS = { io: 'output', unrepresentable: 'any' } as const

// Source : choix de conception, non validé : clé du dialecte, portée par la racine d'un schéma seulement
const DIALECT_KEY = '$schema'

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function withoutDialect(schema: JsonSchema): JsonSchema {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== DIALECT_KEY))
}

function solveRequestMemberOf(entry: LeverCatalogEntry): JsonSchema {
  const territory = entry.territoryRequired
    ? { territory: withoutDialect(z.toJSONSchema(territorySchema, INPUT_OPTIONS)) }
    : {}
  return {
    type: 'object',
    properties: {
      request: {
        type: 'object',
        properties: {
          id: { type: 'string', const: entry.id },
          ...territory,
          parameters: { ...withoutDialect(entry.parametersJsonSchema), required: [] },
        },
        required: entry.territoryRequired ? ['id', 'territory', 'parameters'] : ['id', 'parameters'],
        additionalProperties: false,
      },
      solveFor: { type: 'string', enum: entry.solvableParameters },
      targetReductionTco2e: withoutDialect(z.toJSONSchema(decimalInputSchema, INPUT_OPTIONS)),
    },
    required: ['request', 'solveFor', 'targetReductionTco2e'],
    additionalProperties: false,
  }
}

// Source : choix de conception, non validé : généré depuis requestSchema, le schéma qui valide la requête d'estimate ; les contrôles croisés (parts de lisier qui font 100 %, niveau calculé) restent à l'exécution
const ESTIMATE_REQUEST_JSON_SCHEMA: JsonSchema = deepFreeze(z.toJSONSchema(requestSchema, INPUT_OPTIONS))

// Source : choix de conception, non validé : généré depuis LEVERS_CATALOG ; les paramètres obligatoires de la requête sont tous facultatifs ici, solve contrôle ceux que l'inconnue ne remplace pas
const SOLVE_REQUEST_JSON_SCHEMA: JsonSchema = deepFreeze({
  [DIALECT_KEY]: 'https://json-schema.org/draft/2020-12/schema',
  oneOf: LEVERS_CATALOG.filter(({ solvableParameters }) => solvableParameters.length > 0).map(solveRequestMemberOf),
})

// Source : choix de conception, non validé : généré depuis estimateResponseSchema
const ESTIMATE_RESPONSE_JSON_SCHEMA: JsonSchema = deepFreeze(z.toJSONSchema(estimateResponseSchema, OUTPUT_OPTIONS))

// Source : choix de conception, non validé : généré depuis solutionSchema
const SOLUTION_JSON_SCHEMA: JsonSchema = deepFreeze(z.toJSONSchema(solutionSchema, OUTPUT_OPTIONS))

export {
  ESTIMATE_REQUEST_JSON_SCHEMA,
  ESTIMATE_RESPONSE_JSON_SCHEMA,
  SOLUTION_JSON_SCHEMA,
  SOLVE_REQUEST_JSON_SCHEMA,
}
