type Work<T> = (queued: boolean) => Promise<T>;
type Pending<T> = { work: Work<T>; priority: 0 | 1; promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
type State<T> = { running: boolean; pending: Pending<T> | null };

/** One active snapshot pass and one shared fresh follow-up per client/process. */
export function createRankingRefreshQueue<T = boolean | 'deferred'>() {
  const states = new WeakMap<object, State<T>>();
  function run(client: object, work: Work<T>, priority: 0 | 1, queued = false): Promise<T> {
    let state = states.get(client);
    if (!state) {
      state = { running: false, pending: null };
      states.set(client, state);
    }
    if (state.running) {
      if (!state.pending) {
        const { promise, resolve, reject } = Promise.withResolvers<T>();
        state.pending = { work, priority, promise, resolve, reject };
      } else if (priority >= state.pending.priority) {
        state.pending.work = work;
        state.pending.priority = priority;
      }
      // A new request may refer to writes after the active RPC snapshot. It
      // must await the following pass, not reuse the active pass's result.
      return state.pending.promise;
    }
    state.running = true;
    const result = Promise.resolve().then(() => work(queued));
    const finish = () => {
      state.running = false;
      const pending = state.pending;
      state.pending = null;
      if (pending) run(client, pending.work, pending.priority, true).then(pending.resolve, pending.reject);
      else states.delete(client);
    };
    result.then(finish, finish);
    return result;
  }
  return (client: object, work: Work<T>, priority: 0 | 1 = 0) => run(client, work, priority);
}
