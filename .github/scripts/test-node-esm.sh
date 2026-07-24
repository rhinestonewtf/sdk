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

# Create test script. The SDK is ESM-only with named exports (no default
# export), so use a namespace import.
cat > index.js << 'EOF'
import * as sdk from '@rhinestone/sdk';
console.info('✓ SDK imported successfully');

// Basic smoke test - the namespace should expose the public exports.
if (typeof sdk === 'object' && sdk !== null && typeof sdk.RhinestoneSDK === 'function') {
  console.info('✓ SDK exposes RhinestoneSDK');
} else {
  console.error('✗ SDK import failed - RhinestoneSDK export missing');
  process.exit(1);
}

console.info('✓ Node ESM integration test passed');
EOF

# Run the test
node index.js