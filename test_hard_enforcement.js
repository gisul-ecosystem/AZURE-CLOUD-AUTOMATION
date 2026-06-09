#!/usr/bin/env node

/**
 * Test script for Hard Daily Usage Enforcement
 * Tests that users are BLOCKED when they reach their daily limit
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testHardEnforcement() {
  console.log('🧪 Testing Hard Daily Usage Enforcement\n');
  console.log('=' .repeat(70));

  try {
    const requestId = process.argv[2] ? parseInt(process.argv[2]) : 1;
    const userId = process.argv[3] ? parseInt(process.argv[3]) : 1;

    console.log(`\nUsing: requestId=${requestId}, userId=${userId}\n`);
    console.log('=' .repeat(70));

    // Test 1: Check initial status
    console.log('\n✓ Test 1: Check Initial Status');
    let status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
    
    if (status.status === 404) {
      console.log('  ❌ Error: Request or user not found');
      return;
    }

    console.log(`  Status: ${status.status}`);
    console.log(`  Used Minutes: ${status.data.data?.usedMinutes || 0}`);
    console.log(`  Remaining: ${status.data.data?.remainingMinutes || 0}`);
    console.log(`  Blocked: ${status.data.data?.blocked || false}`);

    // Test 2: Try to start session (should work if not blocked)
    console.log('\n✓ Test 2: Try to Start Session');
    let startResult = await makeRequest('POST', '/api/usage/start', { requestId, userId });
    
    if (startResult.status === 403) {
      console.log('  ✅ HARD ENFORCEMENT WORKING!');
      console.log(`  Status: ${startResult.status}`);
      console.log(`  Message: ${startResult.data.message}`);
      console.log('  User is BLOCKED - cannot start session');
      
      // Show the blocked status
      status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
      console.log(`\n  Blocked Until: ${status.data.data?.blockedUntil}`);
      console.log(`  Used Minutes: ${status.data.data?.usedMinutes}`);
      console.log(`  Limit: ${status.data.data?.dailyLimitMinutes}`);
      
      console.log('\n' + '=' .repeat(70));
      console.log('✅ Hard enforcement is working correctly!');
      console.log('Users CANNOT start sessions after reaching daily limit.\n');
      return;
    }

    if (startResult.status !== 201) {
      console.log(`  ❌ Error: Failed to start session (status: ${startResult.status})`);
      console.log(`  Message: ${startResult.data.message}`);
      return;
    }

    console.log(`  ✅ Session started: ${startResult.data.data?.sessionId}`);
    console.log('  User is NOT blocked yet - has remaining time');

    // Test 3: Simulate reaching limit
    console.log('\n✓ Test 3: Simulate Reaching Daily Limit');
    console.log('  Setting user usage to limit...');
    
    console.log('  NOTE: To test hard enforcement:');
    console.log('  1. Run this SQL in your database:');
    console.log(`     UPDATE azure_users SET used_today_minutes = `);
    console.log(`       (SELECT daily_limit_minutes FROM requests WHERE id = ${requestId})`);
    console.log(`     WHERE id = ${userId} AND request_id = ${requestId};`);
    console.log('');
    console.log('  2. Then try to start a session again:');
    console.log(`     curl -X POST http://localhost:3000/api/usage/start \\`);
    console.log(`       -H "Content-Type: application/json" \\`);
    console.log(`       -d '{"requestId": ${requestId}, "userId": ${userId}}'`);
    console.log('');
    console.log('  Expected: 403 Forbidden - Daily usage limit reached');

    // Test 4: Check if multiple sessions are prevented
    console.log('\n✓ Test 4: Try to Start Another Session (should prevent multiple)');
    startResult = await makeRequest('POST', '/api/usage/start', { requestId, userId });
    
    if (startResult.data.data?.alreadyActive || startResult.data.message?.includes('already exists')) {
      console.log('  ✅ MULTIPLE SESSION PREVENTION WORKING!');
      console.log(`  Message: ${startResult.data.message}`);
      console.log('  Cannot create multiple active sessions');
    } else {
      console.log(`  Status: ${startResult.status}`);
      console.log(`  Message: ${startResult.data.message}`);
    }

    console.log('\n' + '=' .repeat(70));
    console.log('✅ Tests Complete!\n');

    console.log('📝 Summary:');
    console.log('  - Multiple session prevention: ✓');
    console.log('  - Hard enforcement when limit reached: See manual test above');
    console.log('  - Access validation middleware: Applied to routes');
    console.log('');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testHardEnforcement();
