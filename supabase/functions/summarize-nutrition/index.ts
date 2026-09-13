/**
 * summarize-nutrition
 *
 * Generates a personalized NUTRITION assessment for a client's latest
 * submitted onboarding form. See _shared/genai.ts for the full security and
 * caching flow.
 */
import { runAnalysis, buildFormPrompt } from '../_shared/genai.ts';

const RESPONSE_SCHEMA: Record<string, any> = {
  type: 'OBJECT',
  properties: {
    clientSummary: {
      type: 'STRING',
      description:
        '3-6 sentence plain-language summary of the client and their nutrition situation, referencing their answers.',
    },
    keyPoints: {
      type: 'ARRAY',
      description: '5-8 very specific personalized bullets drawn from the client answers.',
      items: { type: 'STRING' },
    },
    nutrition: {
      type: 'OBJECT',
      description: 'Concrete daily nutrition targets.',
      properties: {
        caloriesTarget: {
          type: 'NUMBER',
          description: 'Recommended total daily calorie target (kcal).',
        },
        protein: { type: 'NUMBER', description: 'Recommended daily protein in grams.' },
        carbs: { type: 'NUMBER', description: 'Recommended daily carbs in grams.' },
        fat: { type: 'NUMBER', description: 'Recommended daily fat in grams.' },
        hydrationLiters: {
          type: 'NUMBER',
          description: 'Recommended daily water intake in liters.',
        },
        foodsToInclude: {
          type: 'ARRAY',
          description: 'Foods to prioritize, chosen for THIS client.',
          items: { type: 'STRING' },
        },
        foodsToLimit: {
          type: 'ARRAY',
          description: 'Foods to limit or avoid, given their answers.',
          items: { type: 'STRING' },
        },
        supplements: {
          type: 'ARRAY',
          description: 'Supplements that their answers support, or [] if none.',
          items: { type: 'STRING' },
        },
        mealTiming: {
          type: 'ARRAY',
          description: 'Meal timing guidance around their training schedule.',
          items: { type: 'STRING' },
        },
      },
    },
    coaching: {
      type: 'ARRAY',
      description:
        '3-5 actionable coaching calls to action the coach should communicate next (positive, specific, motivational).',
      items: { type: 'STRING' },
    },
  },
  required: ['clientSummary', 'keyPoints', 'coaching'],
};

function buildPrompt(assessment: Record<string, any>): string {
  return buildFormPrompt(
    assessment,
    [
      'You are a senior coaching nutritionist for the YBS online coaching platform.',
      'A client has completed their onboarding form. Write their PERSONALIZED nutrition',
      'assessment for their coach, covering: recommended daily calories and macro split',
      '(protein, carbs, fat totals), foods to include and limit, meal timing around their',
      'training, hydration, and any supplements their answers support.',
      'Reference their actual answers (body stats, goal, training frequency, food',
      'preferences, schedule, injuries, medical notes).',
    ].join('\n'),
  );
}

async function handler(req: Request): Promise<Response> {
  return runAnalysis({ req, kind: 'nutrition', buildPrompt, responseSchema: RESPONSE_SCHEMA });
}

Deno.serve(handler);