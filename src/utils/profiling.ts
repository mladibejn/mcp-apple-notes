import { log } from '../services/logging';

/**
 * Performance metric data structure
 */
export interface PerformanceMetric {
  startTime: number;
  endTime?: number;
  duration?: number;
  memory?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  metadata?: Record<string, any>;
  // New fields for enhanced metrics
  cpuUsage?: {
    user: number;
    system: number;
  };
  throughput?: number; // operations per second
  latency?: {
    min: number;
    max: number;
    avg: number;
    p95: number; // 95th percentile
    p99: number; // 99th percentile
  };
}

/**
 * Configuration for benchmark runs
 */
export interface BenchmarkConfig {
  iterations?: number; // Number of times to run the operation
  warmupIterations?: number; // Number of iterations to run before measuring
  concurrentOperations?: number; // Number of concurrent operations for load testing
  timeoutMs?: number; // Maximum time to run the benchmark
  collectLatencyHistogram?: boolean; // Whether to collect detailed latency data
  collectMemoryTimeline?: boolean; // Whether to track memory usage over time
  tags?: string[]; // Tags for grouping and filtering benchmarks
}

/**
 * Benchmark result containing detailed performance data
 */
export interface BenchmarkResult {
  config: BenchmarkConfig;
  metrics: PerformanceMetric;
  histogram?: number[]; // Latency histogram data if collected
  memoryTimeline?: Array<{
    timestamp: number;
    heapUsed: number;
    heapTotal: number;
  }>;
  success: boolean;
  error?: Error;
}

/**
 * Performance profiling service for tracking execution metrics
 */
export class PerformanceProfiler {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private baselineMetrics: Map<string, PerformanceMetric> = new Map();
  private histogramBuckets: number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; // ms

  /**
   * Start timing a specific operation
   */
  startOperation(operationName: string, metadata?: Record<string, any>): void {
    const startTime = performance.now();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.metrics.set(operationName, {
      startTime,
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      metadata,
    });

    log('performanceProfiler.debug', {
      message: `Started operation: ${operationName}`,
    });
  }

  /**
   * End timing for an operation and record metrics
   */
  endOperation(operationName: string, metadata?: Record<string, any>): void {
    const metric = this.metrics.get(operationName);
    if (!metric) {
      log('performanceProfiler.warn', {
        message: `No active operation found for: ${operationName}`,
      });
      return;
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    if (metadata) {
      metric.metadata = metadata;
    }

    this.metrics.set(operationName, metric);
    log('performanceProfiler.debug', {
      message: `Operation completed: ${operationName} (duration: ${metric.duration.toFixed(2)}ms)`,
    });
  }

  /**
   * Run a benchmark for a specific operation
   */
  async runBenchmark(
    operationName: string,
    operation: () => Promise<any>,
    config: BenchmarkConfig = {}
  ): Promise<BenchmarkResult> {
    const {
      iterations = 100,
      warmupIterations = 5,
      concurrentOperations = 1,
      timeoutMs = 30000,
      collectLatencyHistogram = true,
      collectMemoryTimeline = true,
      tags = [],
    } = config;

    // Run warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    const latencies: number[] = [];
    const memoryTimeline: Array<{ timestamp: number; heapUsed: number; heapTotal: number }> = [];
    const startTime = performance.now();

    try {
      // Run benchmark iterations
      for (let i = 0; i < iterations; i += concurrentOperations) {
        const batch = Math.min(concurrentOperations, iterations - i);
        const batchPromises = Array(batch)
          .fill(0)
          .map(async () => {
            const iterationStart = performance.now();
            if (collectMemoryTimeline) {
              const memory = process.memoryUsage();
              memoryTimeline.push({
                timestamp: iterationStart - startTime,
                heapUsed: memory.heapUsed,
                heapTotal: memory.heapTotal,
              });
            }

            await operation();

            const iterationDuration = performance.now() - iterationStart;
            latencies.push(iterationDuration);
          });

        await Promise.all(batchPromises);

        if (performance.now() - startTime > timeoutMs) {
          throw new Error(`Benchmark timed out after ${timeoutMs}ms`);
        }
      }

      // Calculate metrics
      const endTime = performance.now();
      const totalDuration = endTime - startTime;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);

      const result: BenchmarkResult = {
        config,
        metrics: {
          startTime,
          endTime,
          duration: totalDuration,
          throughput: (iterations * 1000) / totalDuration, // ops/sec
          latency: {
            min: sortedLatencies[0],
            max: sortedLatencies[sortedLatencies.length - 1],
            avg: sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length,
            p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
            p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)],
          },
          metadata: {
            operationName,
            iterations,
            concurrentOperations,
            tags,
          },
        },
        success: true,
      };

      if (collectLatencyHistogram) {
        result.histogram = this.calculateHistogram(latencies);
      }

      if (collectMemoryTimeline) {
        result.memoryTimeline = memoryTimeline;
      }

      // Store as baseline if none exists
      if (!this.baselineMetrics.has(operationName)) {
        this.baselineMetrics.set(operationName, result.metrics);
      }

      return result;
    } catch (error) {
      return {
        config,
        metrics: {
          startTime,
          endTime: performance.now(),
          metadata: {
            operationName,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Calculate latency histogram data
   */
  private calculateHistogram(latencies: number[]): number[] {
    const histogram = new Array(this.histogramBuckets.length + 1).fill(0);

    for (const latency of latencies) {
      let bucketIndex = this.histogramBuckets.findIndex((bucket) => latency <= bucket);
      if (bucketIndex === -1) bucketIndex = this.histogramBuckets.length;
      histogram[bucketIndex]++;
    }

    return histogram;
  }

  /**
   * Compare current metrics with baseline
   */
  compareWithBaseline(operationName: string): Record<string, number> {
    const current = this.metrics.get(operationName);
    const baseline = this.baselineMetrics.get(operationName);

    if (!current || !baseline) {
      throw new Error(`No metrics found for operation: ${operationName}`);
    }

    return {
      durationDiff:
        (((current.duration || 0) - (baseline.duration || 0)) / (baseline.duration || 1)) * 100,
      throughputDiff:
        (((current.throughput || 0) - (baseline.throughput || 0)) / (baseline.throughput || 1)) *
        100,
      memoryUsageDiff:
        (((current.memory?.heapUsed || 0) - (baseline.memory?.heapUsed || 0)) /
          (baseline.memory?.heapUsed || 1)) *
        100,
    };
  }

  /**
   * Create a decorator for timing function execution
   */
  static profileMethod(operationName?: string) {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
      const originalMethod = descriptor.value;
      const profiler = new PerformanceProfiler();

      descriptor.value = async function (...args: any[]) {
        const methodName = operationName || `${target.constructor.name}.${propertyKey}`;

        profiler.startOperation(methodName);
        try {
          const result = await originalMethod.apply(this, args);
          profiler.endOperation(methodName);
          return result;
        } catch (error) {
          profiler.endOperation(methodName, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
      };

      return descriptor;
    };
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): Map<string, PerformanceMetric> {
    return new Map(this.metrics);
  }

  /**
   * Generate a performance report
   */
  generateReport(): string {
    let report = 'Performance Profiling Report\n';
    report += '===========================\n\n';

    this.metrics.forEach((metric, operation) => {
      report += `Operation: ${operation}\n`;
      report += '-----------------\n';

      // Duration metrics
      if (metric.duration) {
        report += `Duration: ${metric.duration.toFixed(2)}ms\n`;
      }

      // Throughput metrics
      if (metric.throughput) {
        report += `Throughput: ${metric.throughput.toFixed(2)} ops/sec\n`;
      }

      // Latency metrics
      if (metric.latency) {
        report += 'Latency (ms):\n';
        report += `  Min: ${metric.latency.min.toFixed(2)}\n`;
        report += `  Max: ${metric.latency.max.toFixed(2)}\n`;
        report += `  Avg: ${metric.latency.avg.toFixed(2)}\n`;
        report += `  P95: ${metric.latency.p95.toFixed(2)}\n`;
        report += `  P99: ${metric.latency.p99.toFixed(2)}\n`;
      }

      // Memory metrics
      if (metric.memory) {
        report += 'Memory Usage (bytes):\n';
        report += `  Heap Used: ${metric.memory.heapUsed}\n`;
        report += `  Heap Total: ${metric.memory.heapTotal}\n`;
        report += `  External: ${metric.memory.external}\n`;
        report += `  Array Buffers: ${metric.memory.arrayBuffers}\n`;
      }

      // CPU metrics
      if (metric.cpuUsage) {
        report += 'CPU Usage (microseconds):\n';
        report += `  User: ${metric.cpuUsage.user}\n`;
        report += `  System: ${metric.cpuUsage.system}\n`;
      }

      // Baseline comparison
      try {
        const comparison = this.compareWithBaseline(operation);
        report += 'Comparison with Baseline:\n';
        report += `  Duration: ${comparison.durationDiff.toFixed(2)}%\n`;
        report += `  Throughput: ${comparison.throughputDiff.toFixed(2)}%\n`;
        report += `  Memory Usage: ${comparison.memoryUsageDiff.toFixed(2)}%\n`;
      } catch (error) {
        // Skip baseline comparison if not available
      }

      // Additional metadata
      if (metric.metadata) {
        report += 'Additional Metadata:\n';
        Object.entries(metric.metadata).forEach(([key, value]) => {
          report += `  ${key}: ${JSON.stringify(value)}\n`;
        });
      }
      report += '\n';
    });

    return report;
  }

  /**
   * Clear all recorded metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Clear baseline metrics
   */
  clearBaselines(): void {
    this.baselineMetrics.clear();
  }
}
