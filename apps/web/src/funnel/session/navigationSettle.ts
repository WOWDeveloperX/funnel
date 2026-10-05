/** How long after a step change a Continue click is ignored (covers a double click / double tap). */
export const NAV_SETTLE_MS = 350;

/**
 * Remembers when the funnel last navigated. FunnelView marks it on every step change and ignores
 * Continue until it has settled, so the second click of a double click cannot advance the step
 * the first click just opened (which would skip it and emit step_completed for an unseen step).
 */
export class NavigationSettle {
  private at = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly ms: number = NAV_SETTLE_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  mark(): void {
    this.at = this.now();
  }

  settled(): boolean {
    return this.now() - this.at >= this.ms;
  }
}
