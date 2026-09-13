/**
 * summarize-training
 *
 * Generates a personalized TRAINING assessment for a client's latest
 * submitted onboarding form. See _shared/genai.ts for the full security and
 * caching flow.
 */
import { runAnalysis, buildFormPrompt } from '../_shared/genai.ts';

const RESPONSE_SCHEMA: Record<string, any> = {
  type: 'OBJECT',
  properties: {
    trainingSummary: {
      type: 'STRING',
      description:
        '3-6 sentence plain-language summary of the client and their training situation, referencing their answers.',
    },
    keyPoints: {
      type: 'ARRAY',
      description: '5-8 very specific personalized bullets drawn from the client answers.',
      items: { type: 'STRING' },
    },
    program: {
      type: 'OBJECT',
      description: 'Recommended training structure.',
      properties: {
        recommendedSplit: {
          type: 'STRING',
          description: 'Recommended split (e.g. Upper/Lower, PPL, Full Body).',
        },
        weeklyFrequency: {
          type: 'STRING',
          description: 'Recommended training days per week.',
        },
        sessionLength: {
          type: 'STRING',
          description: 'Recommended session length (minutes).',
        },
        sessionVolume: {
          type: 'STRING',
          description: 'Recommended working sets per session / muscle group.',
        },
        focusAreas: {
          type: 'ARRAY',
          description: 'Priority focus areas for this client.',
          items: { type: 'STRING' },
        },
        exerciseRecommendations: {
          type: 'ARRAY',
          description: 'Suggested exercises that fit their experience, goals, equipment and limitations.',
          items: { type: 'STRING' },
        },
        progression: {
          type: 'STRING',
          description: 'A progressive overload plan (how volume/intensity should build).',
        },
        techniqueCues: {
          type: 'ARRAY',
          description: 'Form/technique cues to emphasize for this client.',
          items: { type: 'STRING' },
        },
        injuryConsiderations: {
          type: 'ARRAY',
          description: 'Modifications or cautions driven by their answers (or [] if none).',
          items: { type: 'STRING' },
        },
        recoveryAndRest: {
          type: 'ARRAY',
          description: 'Recovery, sleep and rest-day guidance.',
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
  required: ['trainingSummary', 'keyPoints', 'coaching'],
};

function buildPrompt(assessment: Record<string, any>): string {
  return buildFormPrompt(
    assessment,
    [
      'You are a senior strength & conditioning coach for the YBS online coaching platform.',
      'A client has completed their onboarding form. Write their PERSONALIZED training',
      'assessment for their coach, covering: recommended split, weekly frequency, session',
      'length and volume, priority focus areas, exercise selection that fits their',
      'experience and equipment, a progressive overload plan, technique cues, injury',
      'considerations from their answers, and recovery/rest guidance.',
      'Reference their actual answers (training experience, goal, schedule, injuries,',
      'available equipment, current numbers).',
    ].join('\n'),
  );
}

async function handler(req: Request): Promise<Response> {
  return runAnalysis({ req, kind: 'training', buildPrompt, responseSchema: RESPONSE_SCHEMA });
}

Deno.serve(handler);