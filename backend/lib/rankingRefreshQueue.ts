type Work<T> = (queued: boolean) => Promise<T>;
type Decision<T> = { kind: 'proceed' } | { kind: 'force' } | { kind: 'skip'; result: T };
type Admission<T> = { key: string; check: () => Promise<Decision<T>> };
type Pending<T> = { work: Work<T>; priority: 0 | 1; admissions: Map<string, Admission<T>>; promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
type State<T> = { running: boolean; pending: Pending<T> | null };

/** One active snapshot pass and one shared fresh follow-up per client/process. */
export function createRankingRefreshQueue<T = boolean | 'deferred'>() {
  const states = new WeakMap<object, State<T>>();
  function run(client: object, work: Work<T>, priority: 0 | 1, admissions: Map<string, Admission<T>>, queued = false): Promise<T> {
    let state = states.get(client);
    if (!state) {
      state = { running: false, pending: null };
      states.set(client, state);
    }
    if (state.running) {
      if (!state.pending) {
        const { promise, resolve, reject } = Promise.withResolvers<T>();
        state.pending = { work, priority, admissions, promise, resolve, reject };
      } else if (priority >= state.pending.priority) {
        state.pending.work = work;
        state.pending.priority = priority;
      }
      for (const [key, admission] of admissions) state.pending.admissions.set(key, admission);
      // A new request may refer to writes after the active RPC snapshot. It
      // must await the following pass, not reuse the active pass's result.
      return state.pending.promise;
    }
    state.running = true;
    const result = Promise.resolve().then(async () => {
      if (queued && priority === 0) {
        let skipped: Extract<Decision<T>, { kind: 'skip' }> | null = null;
        let forced = false;
        for (const admission of admissions.values()) {
          const decision = await admission.check();
          if (decision.kind === 'force') { forced = true; break; }
          if (decision.kind === 'skip') skipped ??= decision;
        }
        if (!forced && skipped) return skipped.result;
      }
      return work(queued);
    });
    const finish = () => {
      state.running = false;
      const pending = state.pending;
      state.pending = null;
      if (pending) run(client, pending.work, pending.priority, pending.admissions, true).then(pending.resolve, pending.reject);
      else states.delete(client);
    };
    result.then(finish, finish);
    return result;
  }
  return (client: object, work: Work<T>, priority: 0 | 1 = 0, admission?: Admission<T>) =>
    run(client, work, priority, admission ? new Map([[admission.key, admission]]) : new Map());
}
