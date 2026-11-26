import { z } from 'zod'
import { getStatus, type LeverId, type Status } from '../domain/lever-registry.ts'
import type { Level } from '../domain/territory.ts'
import { requestSchema } from './parse-request.ts'

type JsonSchema = Readonly<Record<string, unknown>>

type LeverCatalogEntry = {
  readonly id: LeverId
  readonly territoryRequired: boolean
  readonly levels: Readonly<Record<Level, Status>>
  readonly parametersJsonSchema: JsonSchema
  readonly solvableParameters: readonly string[]
}

// Source : choix de conception, non validé : paramètres que solve ne peut pas chercher, mesurés sur la région 84 ; horizonYears est une durée (0 refusé), railShareFraction est un réglage du territoire, et la réduction baisse quand cyclologisticTonneKilometres (méthodologie du report modal de marchandises, choix 3), targetNaturalGasShareFraction ou targetFuelOilShareFraction augmentent
const UNSOLVABLE_PARAMETERS: ReadonlySet<string> = new Set([
  'horizonYears',
  'railShareFraction',
  'cyclologisticTonneKilometres',
  'targetNaturalGasShareFraction',
  'targetFuelOilShareFraction',
])

function toLevelStatuses(lever: LeverId): Readonly<Record<Level, Status>> {
  return {
    region: getStatus({ lever, level: 'region' }),
    departement: getStatus({ lever, level: 'departement' }),
    epci: getStatus({ lever, level: 'epci' }),
  }
}

function isNestedObject(schema: unknown): boolean {
  return Reflect.get(Object(schema), 'type') === 'object'
}

function solvableParametersOf(parametersJsonSchema: z.core.JSONSchema.BaseSchema): readonly string[] {
  return Object.entries({ ...parametersJsonSchema.properties })
    .filter(([name, schema]) => !isNestedObject(schema) && !UNSOLVABLE_PARAMETERS.has(name))
    .map(([name]) => name)
}

// Source : choix de conception, non validé : catalogue des leviers dérivé du registre et des schémas de requête, pour documenter l'API d'un consommateur sans copie à tenir à jour ; les schémas décrivent l'entrée (io: input), sans les bornes que le calcul contrôle
const LEVERS_CATALOG: readonly LeverCatalogEntry[] = requestSchema.options.map((schema) => {
  const parametersJsonSchema = z.toJSONSchema(schema.shape.parameters, {
    io: 'input',
    unrepresentable: 'any',
  })
  return {
    id: schema.shape.id.value,
    territoryRequired: 'territory' in schema.shape,
    levels: toLevelStatuses(schema.shape.id.value),
    parametersJsonSchema,
    solvableParameters: solvableParametersOf(parametersJsonSchema),
  }
})

export { LEVERS_CATALOG }
export type { JsonSchema, LeverCatalogEntry }
