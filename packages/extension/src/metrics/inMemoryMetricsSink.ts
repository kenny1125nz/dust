import { MetricsSink, RunStart, StepRecord } from './metricsSink';

/** Test substitute: records run/step events in memory, no SQLite needed. */
export class InMemoryMetricsSink implements MetricsSink {
  private readonly startRecords: RunStart[] = [];
  private readonly stepRecords: StepRecord[] = [];
  private readonly endRecords: string[] = [];

  get runStarts(): readonly RunStart[] {
    return [...this.startRecords];
  }

  get steps(): readonly StepRecord[] {
    return [...this.stepRecords];
  }

  get runEnds(): readonly string[] {
    return [...this.endRecords];
  }

  recordRunStart(run: RunStart): void {
    this.startRecords.push(run);
  }

  recordStep(step: StepRecord): void {
    this.stepRecords.push(step);
  }

  recordRunEnd(runId: string): void {
    this.endRecords.push(runId);
  }
}
