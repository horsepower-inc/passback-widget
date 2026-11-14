export type Boundary = {
  guard<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined;
  guardAsync<A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
  ): (...args: A) => Promise<R | undefined>;
  tripped(): boolean;
};

export function createBoundary(onTrip: (error: unknown) => void): Boundary {
  let isTripped = false;

  const trip = (error: unknown): void => {
    if (isTripped) return;
    isTripped = true;
    try {
      onTrip(error);
    } catch {
      // swallowed: the boundary stays tripped.
    }
  };

  return {
    guard<A extends unknown[], R>(fn: (...args: A) => R) {
      return (...args: A): R | undefined => {
        if (isTripped) return undefined;
        try {
          return fn(...args);
        } catch (error) {
          trip(error);
          return undefined;
        }
      };
    },
    guardAsync<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
      return async (...args: A): Promise<R | undefined> => {
        if (isTripped) return undefined;
        try {
          return await fn(...args);
        } catch (error) {
          trip(error);
          return undefined;
        }
      };
    },
    tripped(): boolean {
      return isTripped;
    },
  };
}
