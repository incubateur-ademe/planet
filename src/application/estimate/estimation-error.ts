import type { DataSourceError } from '../../domain/data-source.ts'
import type { LeverId } from '../../domain/lever-registry.ts'
import type { Level } from '../../domain/territory.ts'
import type { UnknownTerritory } from '../../domain/territory-index.ts'

// Source : choix de conception, non validé : codes stables des issues d'une requête invalide, exposés pour que les consommateurs n'aient pas à lire les messages ; un test vérifie que la liste couvre le type
const ISSUE_CODES = [
  'not_an_object',
  'unknown_lever',
  'unknown_parameter',
  'required',
  'invalid_type',
  'not_a_decimal',
  'out_of_range',
  'invalid_combination',
  'invalid_value',
] as const

type InvalidRequestIssueCode = (typeof ISSUE_CODES)[number]

type InvalidRequest = {
  readonly kind: 'invalid_request'
  readonly issues: ReadonlyArray<{
    readonly parameter: string
    readonly code: InvalidRequestIssueCode
    readonly message: string
  }>
}

type LevelNotComputed = {
  readonly kind: 'level_not_computed'
  readonly lever: LeverId
  readonly level: Level
}

type EstimationError = InvalidRequest | LevelNotComputed | UnknownTerritory | DataSourceError

type UnreachableTarget = {
  readonly kind: 'unreachable_target'
  readonly parameter: string
  readonly minReduction: string
  readonly maxReduction: string
}

type NonMonotonicParameter = {
  readonly kind: 'non_monotonic_parameter'
  readonly parameter: string
}

type SolveError = EstimationError | UnreachableTarget | NonMonotonicParameter

type EstimationErrorKind = EstimationError['kind']

type SolveErrorKind = SolveError['kind']

// Source : choix de conception, non validé : les cinq kind d'EstimationError, exposés pour que les consommateurs dérivent leurs tables d'erreurs ; un test vérifie que la liste couvre le type
const ESTIMATION_ERROR_KINDS = [
  'invalid_request',
  'level_not_computed',
  'unknown_territory',
  'missing_data',
  'invalid_dataset',
] as const satisfies readonly EstimationErrorKind[]

// Source : choix de conception, non validé : les sept kind de SolveError, exposés pour que les consommateurs dérivent leurs tables d'erreurs ; un test vérifie que la liste couvre le type
const SOLVE_ERROR_KINDS = [
  ...ESTIMATION_ERROR_KINDS,
  'unreachable_target',
  'non_monotonic_parameter',
] as const satisfies readonly SolveErrorKind[]

function invalidRequest(issues: InvalidRequest['issues']): InvalidRequest {
  return { kind: 'invalid_request', issues }
}

function levelNotComputed({ lever, level }: Pick<LevelNotComputed, 'lever' | 'level'>): LevelNotComputed {
  return { kind: 'level_not_computed', lever, level }
}

export { ESTIMATION_ERROR_KINDS, invalidRequest, ISSUE_CODES, levelNotComputed, SOLVE_ERROR_KINDS }
export type {
  EstimationError,
  EstimationErrorKind,
  InvalidRequest,
  InvalidRequestIssueCode,
  LevelNotComputed,
  NonMonotonicParameter,
  SolveError,
  SolveErrorKind,
  UnreachableTarget,
}
