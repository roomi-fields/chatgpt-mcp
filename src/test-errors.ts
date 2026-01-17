/**
 * Test error handling and logging
 */

import { ChatGPTError, BrowserError, AuthenticationError, ImageGenerationError, RateLimitError, TimeoutError } from './errors.js';
import { log, logError, logWarn, logDebug } from './config.js';

async function testErrors() {
  console.log('=== Test Error Types ===\n');

  // Test ChatGPTError
  const chatgptError = new ChatGPTError('Generic error', 'GENERIC');
  console.log('ChatGPTError:', chatgptError.toJSON());

  // Test BrowserError
  const browserError = new BrowserError('Browser not initialized');
  console.log('BrowserError:', browserError.toJSON());

  // Test AuthenticationError
  const authError = new AuthenticationError('Not logged in');
  console.log('AuthenticationError:', authError.toJSON());

  // Test ImageGenerationError
  const imageError = new ImageGenerationError('Failed to download');
  console.log('ImageGenerationError:', imageError.toJSON());

  // Test RateLimitError
  const rateError = new RateLimitError('Too many requests', 60000);
  console.log('RateLimitError:', rateError.toJSON());

  // Test TimeoutError
  const timeoutError = new TimeoutError('Operation timed out');
  console.log('TimeoutError:', timeoutError.toJSON());

  // Test error inheritance
  console.log('\n=== Test Inheritance ===');
  console.log('BrowserError instanceof ChatGPTError:', browserError instanceof ChatGPTError);
  console.log('BrowserError instanceof Error:', browserError instanceof Error);

  console.log('\n=== Test Logging ===');

  // Set DEBUG to see all logs
  process.env.DEBUG = 'true';

  logDebug('This is a debug message');
  log('This is an info message');
  logWarn('This is a warning message');
  logError('This is an error message');

  // Test without DEBUG
  delete process.env.DEBUG;
  console.log('\n--- Without DEBUG mode ---');
  logDebug('This debug message should NOT appear');
  log('This info message SHOULD appear');

  console.log('\n=== All Tests Passed ===');
}

testErrors().catch(console.error);
