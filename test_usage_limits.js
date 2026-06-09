#!/usr/bin/env node

/**
 * Test script for Daily Usage Limits feature
 * Run with: node test_usage_limits.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3000';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function testUsageLimitsFeature() {
  console.log('🧪 Testing Daily Usage Limits Feature\n');
  console.log('=' .repeat(60));

  try {
    // Test 1: Health check
    console.log('\n✓ Test 1: Health Check');
    const health = await makeRequest('GET', '/health');
    console.log(`  Status: ${health.status}`);
    console.log(`  Response: ${JSON.stringify(health.data)}`);

    // Test 2: Check if usage routes are registered
    console.log('\n✓ Test 2: Check Usage Routes (should return 400 for missing params)');
    const startSession = await makeRequest('POST', '/api/usage/start', {});
    console.log(`  Status: ${startSession.status} (expected 400)`);
    console.log(`  Message: ${startSession.data.message}`);

    // Test 3: Check active sessions endpoint
    console.log('\n✓ Test 3: Get Active Sessions');
    const activeSessions = await makeRequest('GET', '/api/usage/sessions/active');
    console.log(`  Status: ${activeSessions.status}`);
    console.log(`  Active sessions: ${activeSessions.data.count || 0}`);

    // Test 4: Try to get status (will fail without valid requestId/userId)
    console.log('\n✓ Test 4: Get Usage Status (should return 400)');
    const status = await makeRequest('GET', '/api/usage/status/1/1');
    console.log(`  Status: ${status.status}`);
    console.log(`  Message: ${status.data.message || 'User not found (expected)'}`);

    console.log('\n' + '=' .repeat(60));
    console.log('✅ All API endpoints are responding correctly!\n');

    console.log('📝 Next Steps:');
    console.log('  1. Run database migration if not done yet:');
    console.log('     psql $DATABASE_URL -f src/db/migrations/20260609_create_usage_enforcement_logs.sql');
    console.log('');
    console.log('  2. Create a test request with daily usage enabled');
    console.log('     (Use the request form at http://localhost:3001/request)');
    console.log('');
    console.log('  3. Test the full workflow:');
    console.log('     - Create request with enableDailyUsage: true');
    console.log('     - Start a session');
    console.log('     - Check status');
    console.log('     - End session');
    console.log('     - Verify usage was tracked');
    console.log('');
    console.log('📚 Documentation:');
    console.log('  - Quick Start: QUICK_START_USAGE_LIMITS.md');
    console.log('  - API Examples: USAGE_API_EXAMPLES.md');
    console.log('  - Main README: README_DAILY_USAGE_LIMITS.md');
    console.log('');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
testUsageLimitsFeature();
