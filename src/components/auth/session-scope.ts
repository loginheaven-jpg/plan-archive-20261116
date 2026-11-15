export interface SessionLease {
  readonly owner: string;
  readonly generation: number;
}

/** UI leases are never authority. They prevent cached data/tasks crossing sessions. */
export class SessionScope {
  private generation = 0;

  capture(owner: string): SessionLease {
    return { owner, generation: this.generation };
  }

  invalidate(): void {
    ++this.generation;
  }

  permits(lease: SessionLease | null, owner: string): boolean {
    return (
      !!lease && lease.owner === owner && lease.generation === this.generation
    );
  }
}
