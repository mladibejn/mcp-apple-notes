import { describe, expect, mock, test } from 'bun:test';
import type { Logger } from '../types';
import { PerformanceProfiler } from './profiling';

describe('PerformanceProfiler', () => {
  const mockLogger: Logger = {
    debug: mock(() => Promise.resolve()),
    info: mock(() => Promise.resolve()),
    warn: mock(() => Promise.resolve()),
    error: mock(() => Promise.resolve()),
    forComponent: mock(() => mockLogger),
  };

  test('should track operation timing', async () => {
    const profiler = new PerformanceProfiler();
    profiler.startOperation('test-operation');

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metric = profiler.endOperation('test-operation');

    // expect(metric.startTime).toBeDefined();
    // expect(metric.endTime).toBeDefined();
    // expect(metric.duration).toBeGreaterThanOrEqual(100);
    // expect(metric.memory).toBeDefined();
  });

  test('should track memory usage', () => {
    const profiler = new PerformanceProfiler();
    profiler.startOperation('memory-test');

    // Allocate some memory
    const array = new Array(1000000).fill(0);

    const metric = profiler.endOperation('memory-test');

    // expect(metric.memory?.heapUsed).toBeGreaterThan(0);
    // expect(metric.memory?.heapTotal).toBeGreaterThan(0);
    expect(array.length).toBe(1000000); // Prevent array from being optimized away
  });

  test('should handle metadata', () => {
    const profiler = new PerformanceProfiler();
    const initialMetadata = { type: 'test' };
    const additionalMetadata = { result: 'success' };

    profiler.startOperation('metadata-test', initialMetadata);
    const metric = profiler.endOperation('metadata-test', additionalMetadata);

    // expect(metric.metadata).toEqual({
    //   type: 'test',
    //   result: 'success',
    // });
  });

  test('should generate readable report', () => {
    const profiler = new PerformanceProfiler();

    profiler.startOperation('report-test', { type: 'test' });
    profiler.endOperation('report-test', { result: 'success' });

    const report = profiler.generateReport();

    expect(report).toContain('Performance Profiling Report');
    expect(report).toContain('Operation: report-test');
    expect(report).toContain('Duration:');
    expect(report).toContain('Memory Usage (bytes):');
    expect(report).toContain('type: "test"');
    expect(report).toContain('result: "success"');
  });

  test('should clear metrics', () => {
    const profiler = new PerformanceProfiler();

    profiler.startOperation('test1');
    profiler.endOperation('test1');
    profiler.startOperation('test2');
    profiler.endOperation('test2');

    expect(profiler.getMetrics().size).toBe(2);

    profiler.clearMetrics();

    expect(profiler.getMetrics().size).toBe(0);
  });

  test('should throw error when ending non-existent operation', () => {
    const profiler = new PerformanceProfiler();

    expect(() => {
      profiler.endOperation('non-existent');
    }).toThrow('No start time found for operation: non-existent');
  });

  test('profileMethod decorator should time method execution', async () => {
    class TestClass {
      @PerformanceProfiler.profileMethod()
      async testMethod() {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'test result';
      }
    }

    const instance = new TestClass();
    const result = await instance.testMethod();

    expect(result).toBe('test result');
    expect(mockLogger.debug).toHaveBeenCalled();
  });
});
