import type { Repro, TimelineEvent } from '@passback/schema';

export const WAIT_MIN_MS = 1000;
export const WAIT_MAX_MS = 5000;
export const MAX_REPRO_STEPS = 20;

type Step = Repro['steps'][number];

export type BuildReproInput = {
  url: string;
  timeline: readonly TimelineEvent[];
};

type StepEvent =
  Extract<TimelineEvent, { kind: 'navigation' }> | Extract<TimelineEvent, { kind: 'action' }>;

function isStepEvent(event: TimelineEvent): event is StepEvent {
  return (
    event.kind === 'navigation' ||
    (event.kind === 'action' && event.type === 'click' && event.selector !== undefined)
  );
}

function stepFor(event: StepEvent, lastStep: Step): Step | undefined {
  if (event.kind === 'navigation') {
    if (lastStep.op === 'goto' && lastStep.target === event.to) {
      return undefined;
    }
    return { op: 'goto', target: event.to };
  }

  return event.selector === undefined ? undefined : { op: 'click', target: event.selector };
}

function waitStep(gap: number): Step {
  return { op: 'wait', target: String(Math.min(Math.round(gap), WAIT_MAX_MS)) };
}

export function buildRepro(input: BuildReproInput): Repro {
  const sorted = [...input.timeline].sort((a, b) => a.t - b.t);
  const stepEvents = sorted.filter(isStepEvent);

  const firstNav = stepEvents.find((event) => event.kind === 'navigation');
  const target = firstNav && firstNav.kind === 'navigation' ? firstNav.from : input.url;

  const firstStep: Step = { op: 'goto', target };
  const steps: Step[] = [firstStep];
  let lastStep: Step = firstStep;
  let lastStepEventT: number | undefined;

  for (const event of stepEvents) {
    const newStep = stepFor(event, lastStep);
    if (newStep === undefined) {
      continue;
    }

    if (lastStepEventT !== undefined) {
      const gap = event.t - lastStepEventT;
      if (gap >= WAIT_MIN_MS) {
        steps.push(waitStep(gap));
      }
    }

    steps.push(newStep);
    lastStep = newStep;
    lastStepEventT = event.t;
  }

  if (steps.length > MAX_REPRO_STEPS) {
    return { steps: [firstStep, ...steps.slice(steps.length - (MAX_REPRO_STEPS - 1))] };
  }

  return { steps };
}
