#!/bin/bash
set -e

echo "Testing React Native integration..."

# Create test directory completely outside the repo
mkdir -p /tmp/integration-test/react-native
cd /tmp/integration-test/react-native

# Install Expo CLI globally
npm install -g @expo/cli

# Create new Expo project with web support
npx create-expo-app --template blank-typescript RhinestoneSDKTest
cd RhinestoneSDKTest

# Install web dependencies for React Native
npx expo install react-dom react-native-web @expo/metro-runtime

# Install the packed SDK using absolute path
npm install $GITHUB_WORKSPACE/rhinestone-sdk-*.tgz

# Create test component
cat > App.tsx << 'EOF'
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import sdk from '@rhinestone/sdk';

export default function App() {
  const [testResult, setTestResult] = React.useState<string>('Testing...');
  
  React.useEffect(() => {
    try {
      console.info('✓ SDK imported successfully');
      
      // Basic smoke test - just try to access main exports
      if (typeof sdk === 'object' && sdk !== null) {
        console.info('✓ SDK is an object');
        setTestResult('✓ React Native integration test passed');
      } else {
        console.error('✗ SDK import failed - not an object');
        setTestResult('✓ React Native integration test failed');
      }
    } catch (error) {
      console.error('✗ SDK import failed:', error);
      setTestResult('✗ React Native integration test failed');
    }
  }, []);
  
  return (
    <View style={styles.container}>
      <Text>{testResult}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
EOF

# Create a simple Node.js test to verify the SDK can be imported in a React Native context
cat > test-import.js << 'EOF'
const sdk = require('@rhinestone/sdk');
console.info('✓ SDK imported successfully in React Native project');

// Basic smoke test - just try to access main exports
if (typeof sdk === 'object' && sdk !== null) {
  console.info('✓ SDK is an object');
} else {
  console.error('✗ SDK import failed - not an object');
  process.exit(1);
}

console.info('✓ React Native integration test passed');
EOF

# Run the import test
node test-import.js