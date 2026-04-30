export class ProgressReporter {
  private startTime = Date.now();
  private processed = 0;
  private success = 0;
  private failed = 0;
  private skipped = 0;

  constructor(private total: number) {}

  increment(type: 'success' | 'failed' | 'skipped', count = 1): void {
    this.processed += count;
    if (type === 'success') this.success += count;
    else if (type === 'failed') this.failed += count;
    else this.skipped += count;
  }

  report(mode: string): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.processed > 0 ? (this.processed / elapsed) * 60 : 0;
    const remaining = this.total - this.processed;
    const eta = rate > 0 ? Math.ceil(remaining / rate * 60) : 0;

    const etaStr = eta > 60
      ? `${Math.floor(eta / 60)}m ${eta % 60}s`
      : `${eta}s`;

    process.stderr.write(
      `\r[${mode}] ${this.processed}/${this.total} ` +
      `✓${this.success} ✗${this.failed} ⏭${this.skipped} ` +
      `| ${rate.toFixed(1)}/min` +
      (remaining > 0 ? ` | ETA ${etaStr}` : '') +
      '        ',
    );
  }

  finish(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    process.stderr.write(
      `\nDone in ${elapsed}s — ✓${this.success} ✗${this.failed} ⏭${this.skipped}\n`,
    );
  }
}
