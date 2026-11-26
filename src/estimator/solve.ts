import type BigNumber from 'bignumber.js'
import { err, ok, type Result } from 'neverthrow'
import {
  invalidRequest,
  type InvalidRequestIssueCode,
  type SolveError,
} from '../application/estimate/estimation-error.ts'
import { decimalTextPattern, numberToDecimalText, roundOutput, toBig } from '../domain/big-number.ts'
import type { EstimateUntrustedRequest } from '../create-default-estimator.ts'
import type { Estimate } from './estimate.ts'

type Solution = {
  readonly solveFor: string
  readonly value: string
  readonly estimate: Estimate
}

type SolveInput = {
  readonly request: unknown
  readonly solveFor: string
  readonly targetReductionTco2e: unknown
}

type Solver = (input: SolveInput) => Result<Solution, SolveError>

type Probe = {
  readonly value: BigNumber
  readonly estimate: Estimate
  readonly reduction: BigNumber
}

type Bracket = { readonly low: Probe; readonly high: Probe }

// Source : choix de conception, non validé : valeur de départ de la recherche, la réduction de base du levier
const BASE_VALUE = toBig('0')

// Source : choix de conception, non validé : première borne haute essayée, le maximum d'une fraction
const FIRST_UPPER_VALUE = toBig('1')

// Source : choix de conception, non validé : la borne haute double tant que la cible n'est pas dépassée
const UPPER_VALUE_GROWTH = toBig('2')

// Source : choix de conception, non validé : 2^60 dépasse toute valeur de paramètre réaliste ; au-delà, la réduction plafonne
const MAX_UPPER_VALUE_DOUBLINGS = toBig('60')

// Source : choix de conception, non validé : 2^-100 sous la précision de calcul, une réduction qui n'atteint jamais la cible saute
const MAX_BISECTIONS = toBig('100')

// Source : choix de conception, non validé : 2^-60 sous toute précision utile, le maximum admis d'un paramètre est cherché à cette finesse
const MAX_VALIDITY_BISECTIONS = toBig('60')

// Source : choix de conception, non validé : 10^-9 de l'écart, la sonde qui conclut que la valeur valide est déjà le maximum admis ; une borne plus proche que cela est confondue avec la valeur valide
const NEAR_BOUND_RATIO = toBig('0.000000001')

// Source : choix de conception, non validé : milieu d'un intervalle
const MIDPOINT_RATIO = toBig('0.5')

// Source : choix de conception, non validé : la valeur renvoyée est la plus courte qui donne encore la cible, de zéro à douze décimales
const SHORTEST_VALUE_PLACES_COUNT = 13

// Source : choix de conception, non validé : les nombres de décimales essayés, de 0 à 12
const SHORTEST_VALUE_DECIMAL_PLACES = Array.from({ length: SHORTEST_VALUE_PLACES_COUNT }, (_, places) => places)

// Source : choix de conception, non validé : séparateur du chemin d'un paramètre imbriqué, par exemple animals.dairyCows.headcountReductionFraction
const PATH_SEPARATOR = '.'

// Source : choix de conception, non validé : nom du paramètre d'objectif dans les issues d'une requête invalide
const TARGET_PARAMETER = 'targetReductionTco2e'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setAt(node: unknown, keys: readonly string[], value: string): unknown {
  const [key, ...rest] = keys
  if (key === undefined) return value
  const record = isRecord(node) ? node : {}
  return { ...record, [key]: setAt(record[key], rest, value) }
}

function withParameter(request: unknown, solveFor: string, value: BigNumber): unknown {
  if (!isRecord(request) || !isRecord(request.parameters)) return request
  return { ...request, parameters: setAt(request.parameters, solveFor.split(PATH_SEPARATOR), value.toFixed()) }
}

function invalidTarget(code: InvalidRequestIssueCode, message: string): SolveError {
  return invalidRequest([{ parameter: TARGET_PARAMETER, code, message }])
}

function parseTarget(targetReductionTco2e: unknown): Result<string, SolveError> {
  const text = typeof targetReductionTco2e === 'number' ? numberToDecimalText(targetReductionTco2e) : targetReductionTco2e
  if (typeof text !== 'string') return err(invalidTarget('invalid_type', 'must be a decimal number'))
  if (!decimalTextPattern.test(text)) return err(invalidTarget('not_a_decimal', 'must be a decimal number'))
  const target = roundOutput(toBig(text))
  if (target.isNegative()) return err(invalidTarget('out_of_range', 'must not be negative'))
  return ok(target.toFixed())
}

function isInvalidRequest(error: SolveError): boolean {
  return error.kind === 'invalid_request'
}

function createSolver(estimate: EstimateUntrustedRequest): Solver {
  function probe(request: unknown, solveFor: string, value: BigNumber): Result<Probe, SolveError> {
    return estimate(withParameter(request, solveFor, value)).map((result) => ({
      value,
      estimate: result,
      reduction: toBig(result.reduction),
    }))
  }

  function largestValidValue(
    request: unknown,
    solveFor: string,
    valid: Probe,
    invalidValue: BigNumber,
    remaining: BigNumber,
  ): Probe {
    if (remaining.isZero()) return valid
    const sumOfBounds = valid.value.plus(invalidValue)
    const middle = sumOfBounds.times(MIDPOINT_RATIO)
    const nextRemaining = remaining.minus(FIRST_UPPER_VALUE)
    return probe(request, solveFor, middle).match(
      (found) => largestValidValue(request, solveFor, found, invalidValue, nextRemaining),
      () => largestValidValue(request, solveFor, valid, middle, nextRemaining),
    )
  }

  function largestValueBelow(
    request: unknown,
    solveFor: string,
    valid: Probe,
    invalidValue: BigNumber,
  ): Probe {
    const gap = invalidValue.minus(valid.value)
    const nearOffset = gap.times(NEAR_BOUND_RATIO)
    const nearValue = valid.value.plus(nearOffset)
    return probe(request, solveFor, nearValue).match(
      (near) => largestValidValue(request, solveFor, near, invalidValue, MAX_VALIDITY_BISECTIONS),
      () => valid,
    )
  }

  function probeOrLargestValid(
    request: unknown,
    solveFor: string,
    valid: Probe,
    value: BigNumber,
  ): Result<Probe, SolveError> {
    return probe(request, solveFor, value).orElse((error) =>
      isInvalidRequest(error)
        ? ok(largestValueBelow(request, solveFor, valid, value))
        : err(error),
    )
  }

  function unreachable(solveFor: string, lowest: Probe, highest: Probe): SolveError {
    return {
      kind: 'unreachable_target',
      solveFor,
      minReduction: lowest.estimate.reduction,
      maxReduction: highest.estimate.reduction,
    }
  }

  function nonMonotonic(solveFor: string): SolveError {
    return { kind: 'non_monotonic_parameter', solveFor }
  }

  function toSolution(solveFor: string, found: Probe): Solution {
    return Object.freeze({ solveFor, value: found.value.toFixed(), estimate: found.estimate })
  }

  function shortestSolution(request: unknown, solveFor: string, found: Probe, target: string): Solution {
    const matching = SHORTEST_VALUE_DECIMAL_PLACES.flatMap((places) =>
      probe(request, solveFor, found.value.decimalPlaces(places)).match(
        (candidate) => (candidate.estimate.reduction === target ? [candidate] : []),
        () => [],
      ),
    )
    return toSolution(solveFor, matching.reduce<Probe>((shortest, candidate) => (shortest === found ? candidate : shortest), found))
  }

  function bisect(
    request: unknown,
    solveFor: string,
    { low, high }: Bracket,
    target: string,
    remaining: BigNumber,
  ): Result<Solution, SolveError> {
    if (remaining.isZero()) return err(nonMonotonic(solveFor))
    const sumOfBounds = low.value.plus(high.value)
    const middle = sumOfBounds.times(MIDPOINT_RATIO)
    return probe(request, solveFor, middle).andThen((found) => {
      if (found.estimate.reduction === target) return ok(shortestSolution(request, solveFor, found, target))
      const next = found.reduction.isLessThan(target)
        ? { low: found, high }
        : { low, high: found }
      return bisect(request, solveFor, next, target, remaining.minus(FIRST_UPPER_VALUE))
    })
  }

  function raiseUpperBound(
    request: unknown,
    solveFor: string,
    base: Probe,
    { low, high }: Bracket,
    target: string,
    remaining: BigNumber,
  ): Result<Bracket, SolveError> {
    if (high.reduction.isGreaterThanOrEqualTo(target)) return ok({ low, high })
    if (remaining.isZero()) return err(unreachable(solveFor, base, high))
    const nextValue = high.value.times(UPPER_VALUE_GROWTH)
    return probeOrLargestValid(request, solveFor, high, nextValue).andThen((next) =>
      next.value.isEqualTo(high.value)
        ? err(unreachable(solveFor, base, high))
        : raiseUpperBound(request, solveFor, base, { low: high, high: next }, target, remaining.minus(FIRST_UPPER_VALUE)),
    )
  }

  return ({ request, solveFor, targetReductionTco2e }) =>
    parseTarget(targetReductionTco2e).andThen((target) =>
      probe(request, solveFor, BASE_VALUE).andThen((base) =>
        probeOrLargestValid(request, solveFor, base, FIRST_UPPER_VALUE).andThen((first) => {
          if (first.reduction.isLessThan(base.reduction)) return err(nonMonotonic(solveFor))
          if (base.estimate.reduction === target) return ok(toSolution(solveFor, base))
          if (base.reduction.isGreaterThan(target)) return err(unreachable(solveFor, base, first))
          return raiseUpperBound(request, solveFor, base, { low: base, high: first }, target, MAX_UPPER_VALUE_DOUBLINGS).andThen(
            (bracket) => bisect(request, solveFor, bracket, target, MAX_BISECTIONS),
          )
        }),
      ),
    )
}

export { createSolver }
export type { SolveInput, Solution, Solver }
