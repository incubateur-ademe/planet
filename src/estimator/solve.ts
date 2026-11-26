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
  readonly parameter: string
  readonly value: string
  readonly estimate: Estimate
}

type Solver = (request: unknown, parameter: string, targetReduction: unknown) => Result<Solution, SolveError>

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

// Source : choix de conception, non validé : milieu d'un intervalle
const MIDPOINT_RATIO = toBig('0.5')

// Source : choix de conception, non validé : la valeur renvoyée est la plus courte qui donne encore la cible, de zéro à douze décimales
const SHORTEST_VALUE_PLACES_COUNT = 13

// Source : choix de conception, non validé : les nombres de décimales essayés, de 0 à 12
const SHORTEST_VALUE_DECIMAL_PLACES = Array.from({ length: SHORTEST_VALUE_PLACES_COUNT }, (_, places) => places)

// Source : choix de conception, non validé : nom du paramètre d'objectif dans les issues d'une requête invalide
const TARGET_PARAMETER = 'targetReduction'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withParameter(request: unknown, parameter: string, value: BigNumber): unknown {
  if (!isRecord(request) || !isRecord(request.parameters)) return request
  return { ...request, parameters: { ...request.parameters, [parameter]: value.toFixed() } }
}

function invalidTarget(code: InvalidRequestIssueCode, message: string): SolveError {
  return invalidRequest([{ parameter: TARGET_PARAMETER, code, message }])
}

function parseTarget(targetReduction: unknown): Result<string, SolveError> {
  const text = typeof targetReduction === 'number' ? numberToDecimalText(targetReduction) : targetReduction
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
  function probe(request: unknown, parameter: string, value: BigNumber): Result<Probe, SolveError> {
    return estimate(withParameter(request, parameter, value)).map((result) => ({
      value,
      estimate: result,
      reduction: toBig(result.reduction),
    }))
  }

  function largestValidValue(
    request: unknown,
    parameter: string,
    valid: Probe,
    invalidValue: BigNumber,
    remaining: BigNumber,
  ): Probe {
    if (remaining.isZero()) return valid
    const sumOfBounds = valid.value.plus(invalidValue)
    const middle = sumOfBounds.times(MIDPOINT_RATIO)
    const nextRemaining = remaining.minus(FIRST_UPPER_VALUE)
    return probe(request, parameter, middle).match(
      (found) => largestValidValue(request, parameter, found, invalidValue, nextRemaining),
      () => largestValidValue(request, parameter, valid, middle, nextRemaining),
    )
  }

  function probeOrLargestValid(
    request: unknown,
    parameter: string,
    valid: Probe,
    value: BigNumber,
  ): Result<Probe, SolveError> {
    return probe(request, parameter, value).orElse((error) =>
      isInvalidRequest(error)
        ? ok(largestValidValue(request, parameter, valid, value, MAX_VALIDITY_BISECTIONS))
        : err(error),
    )
  }

  function unreachable(parameter: string, lowest: Probe, highest: Probe): SolveError {
    return {
      kind: 'unreachable_target',
      parameter,
      minReduction: lowest.estimate.reduction,
      maxReduction: highest.estimate.reduction,
    }
  }

  function nonMonotonic(parameter: string): SolveError {
    return { kind: 'non_monotonic_parameter', parameter }
  }

  function toSolution(parameter: string, found: Probe): Solution {
    return { parameter, value: found.value.toFixed(), estimate: found.estimate }
  }

  function shortestSolution(request: unknown, parameter: string, found: Probe, target: string): Solution {
    const matching = SHORTEST_VALUE_DECIMAL_PLACES.flatMap((places) =>
      probe(request, parameter, found.value.decimalPlaces(places)).match(
        (candidate) => (candidate.estimate.reduction === target ? [candidate] : []),
        () => [],
      ),
    )
    return toSolution(parameter, matching.reduce<Probe>((shortest, candidate) => (shortest === found ? candidate : shortest), found))
  }

  function bisect(
    request: unknown,
    parameter: string,
    { low, high }: Bracket,
    target: string,
    remaining: BigNumber,
  ): Result<Solution, SolveError> {
    if (remaining.isZero()) return err(nonMonotonic(parameter))
    const sumOfBounds = low.value.plus(high.value)
    const middle = sumOfBounds.times(MIDPOINT_RATIO)
    return probe(request, parameter, middle).andThen((found) => {
      if (found.estimate.reduction === target) return ok(shortestSolution(request, parameter, found, target))
      const next = found.reduction.isLessThan(target)
        ? { low: found, high }
        : { low, high: found }
      return bisect(request, parameter, next, target, remaining.minus(FIRST_UPPER_VALUE))
    })
  }

  function raiseUpperBound(
    request: unknown,
    parameter: string,
    base: Probe,
    { low, high }: Bracket,
    target: string,
    remaining: BigNumber,
  ): Result<Bracket, SolveError> {
    if (high.reduction.isGreaterThanOrEqualTo(target)) return ok({ low, high })
    if (remaining.isZero()) return err(unreachable(parameter, base, high))
    const nextValue = high.value.times(UPPER_VALUE_GROWTH)
    return probeOrLargestValid(request, parameter, high, nextValue).andThen((next) =>
      next.value.isEqualTo(high.value)
        ? err(unreachable(parameter, base, high))
        : raiseUpperBound(request, parameter, base, { low: high, high: next }, target, remaining.minus(FIRST_UPPER_VALUE)),
    )
  }

  return (request, parameter, targetReduction) =>
    parseTarget(targetReduction).andThen((target) =>
      probe(request, parameter, BASE_VALUE).andThen((base) =>
        probeOrLargestValid(request, parameter, base, FIRST_UPPER_VALUE).andThen((first) => {
          if (first.reduction.isLessThan(base.reduction)) return err(nonMonotonic(parameter))
          if (base.estimate.reduction === target) return ok(toSolution(parameter, base))
          if (base.reduction.isGreaterThan(target)) return err(unreachable(parameter, base, first))
          return raiseUpperBound(request, parameter, base, { low: base, high: first }, target, MAX_UPPER_VALUE_DOUBLINGS).andThen(
            (bracket) => bisect(request, parameter, bracket, target, MAX_BISECTIONS),
          )
        }),
      ),
    )
}

export { createSolver }
export type { Solution, Solver }
