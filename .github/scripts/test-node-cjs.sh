#!/bin/bash
set -e

echo "Testing Node CommonJS integration..."

# Create test directory completely outside the repo
mkdir -p /tmp/integration-test/node-cjs
cd /tmp/integration-test/node-cjs

# Initialize basic Node project
npm init -y

# Install the packed SDK using absolute path
npm install $GITHUB_WORKSPACE/rhinestone-sdk-*.tgz

# Create test script
cat > index.js << 'EOF'
const sdk = require('@rhinestone/sdk');
console.info('✓ SDK imported successfully');

// Basic smoke test - just try to access main exports
if (typeof sdk === 'object' && sdk !== null) {
  console.info('✓ SDK is an object');
} else {
  console.error('✗ SDK import failed - not an object');
  process.exit(1);
}

console.info('✓ Node CommonJS integration test passed');
EOF

# Run the test
node index.js