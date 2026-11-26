import { z } from 'zod'
import { decimalTextPattern } from '../domain/big-number.ts'
import { ESTIMATE_STATUSES } from '../domain/lever-registry.ts'

const decimalTextSchema = z.string().regex(decimalTextPattern).meta({
  description: 'Texte décimal, sans notation scientifique',
})

const appliedAssumptionSchema = z.strictObject({
  value: z.string(),
  source: z.string(),
  limit: z.string(),
})

const leverLimitSchema = z.strictObject({
  limit: z.string(),
  effect: z.string(),
})

const datasetProvenanceSchema = z.strictObject({
  dataset: z.string(),
  source: z.string(),
  vintage: z.string(),
  retrievedOn: z.string(),
})

const estimateResponseSchema = z.strictObject({
  reduction: decimalTextSchema.meta({
    description: 'tCO2e évitées par an, texte décimal arrondi à deux décimales',
  }),
  appliedAssumptions: z.record(z.string(), appliedAssumptionSchema),
  status: z.enum(ESTIMATE_STATUSES),
  limits: z.array(leverLimitSchema),
  datasets: z.array(datasetProvenanceSchema),
})

const solutionSchema = z.strictObject({
  solveFor: z.string(),
  value: decimalTextSchema.meta({ description: 'Valeur du paramètre cherché, texte décimal' }),
  estimate: estimateResponseSchema,
})

export { estimateResponseSchema, solutionSchema }
