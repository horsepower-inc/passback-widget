export interface Effect {
  readonly release: () => void | Promise<void>;
}

export interface Scope {
  readonly acquire: <T extends Effect>(effect: T) => T;
}

const releaseFrom = (
  effects: readonly Effect[],
  index: number,
  failures: unknown[],
): Promise<void> => {
  if (index < 0) return Promise.resolve();
  return Promise.resolve()
    .then(() => effects[index]!.release())
    .catch((error: unknown) => {
      failures.push(error);
    })
    .then(() => releaseFrom(effects, index - 1, failures));
};

const releaseAll = (effects: readonly Effect[]): Promise<unknown[]> => {
  const failures: unknown[] = [];
  return releaseFrom(effects, effects.length - 1, failures).then(() => failures);
};

const settleFailures = (failures: unknown[]): void => {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, 'effect release failed');
};

export const withScope = <T>(body: (scope: Scope) => T | Promise<T>): Promise<T> => {
  const effects: Effect[] = [];
  const scope: Scope = {
    acquire: <E extends Effect>(effect: E): E => {
      effects.push(effect);
      return effect;
    },
  };

  return Promise.resolve()
    .then(() => body(scope))
    .then(
      (value) =>
        releaseAll(effects).then((failures) =>
          Promise.resolve()
            .then(() => settleFailures(failures))
            .then(() => value),
        ),
      (bodyError: unknown) => releaseAll(effects).then(() => Promise.reject(bodyError)),
    );
};
