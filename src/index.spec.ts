import { describe, expect, expectTypeOf, it } from 'vitest'
import { LEVELS, LEVERS_CATALOG, type Level, type SolveInput } from './index.ts'

describe('index', () => {
  it('exporte les niveaux de territoire à l’exécution, ceux du catalogue', () => {
    expect([...LEVELS].toSorted()).toEqual(['departement', 'epci', 'region'])
    for (const { levels } of LEVERS_CATALOG) expect(Object.keys(levels).toSorted()).toEqual([...LEVELS].toSorted())
  })

  it('couvre exactement le type Level', () => {
    expectTypeOf<(typeof LEVELS)[number]>().toEqualTypeOf<Level>()
  })

  it('exporte le type de l’entrée de solve', () => {
    expectTypeOf<SolveInput>().toHaveProperty('solveFor').toEqualTypeOf<string>()
    expectTypeOf<SolveInput>().toHaveProperty('targetReductionTco2e')
    expectTypeOf<SolveInput>().toHaveProperty('request')
  })
})
