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

// Source : choix de conception, non validé : séparateur du chemin d'un paramètre imbriqué, le même que solve
const PATH_SEPARATOR = '.'

// Source : choix de conception, non validé : paramètres que solve ne peut pas chercher, mesurés sur la région 84 ; targetManureShares réunit quatre parts qui font 100 % ensemble, aucune ne varie seule ; les volailles ont un facteur entérique nul (src/levers/elevage-durable/animal-parameters.ts), leur baisse entérique n'a aucun effet ; horizonYears est une durée (0 refusé), railShareFraction est un réglage du territoire, et la réduction baisse quand cyclologisticTonneKilometres (méthodologie du report modal de marchandises, choix 3), targetNaturalGasShareFraction ou targetFuelOilShareFraction augmentent
const UNSOLVABLE_PARAMETERS: ReadonlySet<string> = new Set([
  'horizonYears',
  'railShareFraction',
  'cyclologisticTonneKilometres',
  'targetNaturalGasShareFraction',
  'targetFuelOilShareFraction',
  'targetManureShares',
  'animals.layingHens.entericEmissionReductionFraction',
  'animals.broilers.entericEmissionReductionFraction',
  'animals.otherPoultry.entericEmissionReductionFraction',
])

function toLevelStatuses(lever: LeverId): Readonly<Record<Level, Status>> {
  return {
    region: getStatus({ lever, level: 'region' }),
    departement: getStatus({ lever, level: 'departement' }),
    epci: getStatus({ lever, level: 'epci' }),
  }
}

const jsonSchemaNodeSchema = z
  .looseObject({ type: z.string().optional(), properties: z.record(z.string(), z.unknown()).optional() })
  .catch({})

function leafPathsOf(node: unknown, ancestors: readonly string[]): readonly (readonly string[])[] {
  const { properties } = jsonSchemaNodeSchema.parse(node)
  return Object.entries({ ...properties }).flatMap(([name, child]) => {
    const path = [...ancestors, name]
    return jsonSchemaNodeSchema.parse(child).type === 'object' ? leafPathsOf(child, path) : [path]
  })
}

function solvableParametersOf(parametersJsonSchema: JsonSchema): readonly string[] {
  return leafPathsOf(parametersJsonSchema, [])
    .map((path) => ({ path, text: path.join(PATH_SEPARATOR) }))
    .filter(({ path, text }) => !UNSOLVABLE_PARAMETERS.has(text) && !path.some((name) => UNSOLVABLE_PARAMETERS.has(name)))
    .map(({ text }) => text)
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
