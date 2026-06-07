/**
 * Node.js test runner for services/drive.js
 * Simulates browser APIs and runs unit tests.
 */

// Re-export from the test file which sets up globals and runs tests
await import('./unit/drive.test.js');
