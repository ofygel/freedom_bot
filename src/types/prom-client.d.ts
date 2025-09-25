declare module 'prom-client' {
  export class Registry {
    constructor();
    setDefaultLabels(labels: Record<string, string>): void;
    metrics(): Promise<string>;
    readonly contentType: string;
  }

  export interface CounterConfiguration<TLabel extends string = string> {
    name: string;
    help: string;
    labelNames?: readonly TLabel[];
    registers?: Registry[];
  }

  export interface HistogramConfiguration<TLabel extends string = string> {
    name: string;
    help: string;
    labelNames?: readonly TLabel[];
    buckets?: number[];
    registers?: Registry[];
  }

  export class Counter<TLabel extends string = string> {
    constructor(configuration: CounterConfiguration<TLabel>);
    inc(labels?: Record<TLabel, string>, value?: number): void;
    reset(): void;
  }

  export class Histogram<TLabel extends string = string> {
    constructor(configuration: HistogramConfiguration<TLabel>);
    startTimer(labels?: Record<TLabel, string>): () => void;
    reset(): void;
  }

  export function collectDefaultMetrics(options: { register?: Registry }): void;
}
