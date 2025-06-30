const sdk = require('@rhinestone/sdk');
console.log('✓ SDK imported successfully');

// Basic smoke test - just try to access main exports
if (typeof sdk === 'object' && sdk !== null) {
  console.log('✓ SDK is an object');
} else {
  console.error('✗ SDK import failed - not an object');
  process.exit(1);
}

console.log('✓ Node CommonJS integration test passed');