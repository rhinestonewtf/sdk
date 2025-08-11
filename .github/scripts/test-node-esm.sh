#!/bin/bash
set -e

echo "Testing Node ESM integration..."

# Create test directory completely outside the repo
mkdir -p /tmp/integration-test/node-esm
cd /tmp/integration-test/node-esm

# Initialize basic Node project with ESM
npm init -y
# Set package type to module for ESM
npm pkg set type=module

# Install the packed SDK using absolute path
npm install $GITHUB_WORKSPACE/rhinestone-sdk-*.tgz

# Create test script
cat > index.js << 'EOF'
import sdk from '@rhinestone/sdk';
console.info('✓ SDK imported successfully');

// Basic smoke test - just try to access main exports
if (typeof sdk === 'object' && sdk !== null) {
  console.info('✓ SDK is an object');
} else {
  console.error('✗ SDK import failed - not an object');
  process.exit(1);
}

console.info('✓ Node ESM integration test passed');
EOF

# Run the test
node index.js