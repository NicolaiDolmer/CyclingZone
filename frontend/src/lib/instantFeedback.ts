export type NotificationChange = {
  kind: "read" | "delete";
  ids: ReadonlySet<string>;
};

export function applyNotificationChanges<T extends { id: string; is_read: boolean }>(
  rows: T[],
  changes: readonly NotificationChange[],
): T[] {
  return changes.reduce((visible, change) => change.kind === "delete"
    ? visible.filter((row) => !change.ids.has(row.id))
    : visible.map((row) => change.ids.has(row.id) && !row.is_read ? { ...row, is_read: true } : row), rows);
}

// The server returns one shared slot count. Serialize the writes even when
// different riders are involved, and let each rider retain its own pending state.
export class TrainingPlanWrites {
  private tail: Promise<void> = Promise.resolve();
  private counts = new Map<string, number>();
  private generation = 0;

  get revision() { return this.generation; }
  get savingIds() { return new Set(this.counts.keys()); }

  acceptsRead(revision: number) {
    return this.counts.size === 0 && this.generation === revision;
  }

  enqueue<T>(ids: readonly string[], write: () => Promise<T>, notify: () => void): Promise<T> {
    const unique = new Set(ids);
    this.generation++;
    for (const id of unique) this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    notify();
    const result = this.tail.then(write).finally(() => {
      for (const id of unique) {
        const remaining = (this.counts.get(id) ?? 1) - 1;
        if (remaining > 0) this.counts.set(id, remaining);
        else this.counts.delete(id);
      }
      this.generation++;
      notify();
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
