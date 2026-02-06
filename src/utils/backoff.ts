/**
 * Fibonacci backoff utility for smart polling
 *
 * Uses increasing delays to balance responsiveness for quick responses
 * while avoiding excessive polling for long-running operations.
 */

// Fibonacci-based delays in seconds: 2, 3, 5, 8, 13, 21, 30 (capped)
const FIB_DELAYS = [2, 3, 5, 8, 13, 21, 30];

/**
 * Get the backoff delay for a given poll number
 *
 * @param pollNumber - Zero-indexed poll attempt number
 * @param maxSeconds - Maximum delay cap (default: 30)
 * @returns Delay in milliseconds
 *
 * Poll schedule:
 *   Poll 0: 2s
 *   Poll 1: 3s
 *   Poll 2: 5s
 *   Poll 3: 8s
 *   Poll 4: 13s
 *   Poll 5: 21s
 *   Poll 6+: 30s (capped)
 */
export function fibonacciBackoff(pollNumber: number, maxSeconds = 30): number {
  const index = Math.min(pollNumber, FIB_DELAYS.length - 1);
  const seconds = Math.min(FIB_DELAYS[index], maxSeconds);
  return seconds * 1000;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
