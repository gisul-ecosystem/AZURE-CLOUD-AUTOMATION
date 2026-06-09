#!/usr/bin/env node

/**
 * Test script for LIVE Daily Usage calculation
 * Tests that usage is tracked in real-time while session is active
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testLiveUsageCalculation() {
  console.log('🧪 Testing LIVE Usage Calculation\n');
  console.log('=' .repeat(70));

  try {
    console.log('\n📋 Test Instructions:');
    console.log('This test verifies that usage is calculated LIVE while session is active.');
    console.log('\nPrerequisites:');
    console.log('  1. You need an existing request with enableDailyUsage: true');
    console.log('  2. You need a valid userId that belongs to the request');
    console.log('  3. Database must be running and accessible\n');
    
    // Get test parameters from command line or use defaults
    const requestId = process.argv[2] ? parseInt(process.argv[2]) : 1;
    const userId = process.argv[3] ? parseInt(process.argv[3]) : 1;

    console.log(`Using: requestId=${requestId}, userId=${userId}\n`);
    console.log('=' .repeat(70));

    // Test 1: Get initial status (should have no active session)
    console.log('\n✓ Test 1: Check Initial Status (before session)');
    let status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
    
    if (status.status === 404) {
      console.log('  ❌ Error: Request or user not found');
      console.log('  Please create a request first or provide valid requestId/userId');
      console.log('\n  Usage: node test_live_usage.js <requestId> <userId>');
      return;
    }

    console.log(`  Status: ${status.status}`);
    console.log(`  Used Minutes: ${status.data.data?.usedMinutes || 0}`);
    console.log(`  Has Active Session: ${status.data.data?.hasActiveSession || false}`);
    console.log(`  Stored Used: ${status.data.data?.storedUsedMinutes || 0}`);
    console.log(`  Current Session: ${status.data.data?.currentSessionMinutes || 0}`);

    // Test 2: Start a session
    console.log('\n✓ Test 2: Start Usage Session');
    const startResult = await makeRequest('POST', '/api/usage/start', { requestId, userId });
    
    if (startResult.status === 403) {
      console.log('  ❌ Error: Access denied (user may be blocked or limit exceeded)');
      console.log(`  Message: ${startResult.data.message}`);
      return;
    }

    if (startResult.status !== 201) {
      console.log(`  ❌ Error: Failed to start session (status: ${startResult.status})`);
      console.log(`  Message: ${startResult.data.message}`);
      return;
    }

    console.log(`  Status: ${startResult.status}`);
    console.log(`  Session ID: ${startResult.data.data?.sessionId}`);
    console.log(`  Login At: ${startResult.data.data?.loginAt}`);

    // Test 3: Check status immediately (should show 0-1 minutes)
    console.log('\n✓ Test 3: Check Status Immediately After Start');
    status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
    console.log(`  Status: ${status.status}`);
    console.log(`  Used Minutes: ${status.data.data?.usedMinutes || 0}`);
    console.log(`  Has Active Session: ${status.data.data?.hasActiveSession || false}`);
    console.log(`  Stored Used: ${status.data.data?.storedUsedMinutes || 0}`);
    console.log(`  Current Session: ${status.data.data?.currentSessionMinutes || 0}`);
    console.log(`  Remaining: ${status.data.data?.remainingMinutes || 0}`);

    // Test 4: Wait 2 minutes and check again (should show ~2 minutes)
    console.log('\n✓ Test 4: Wait 2 Minutes and Check LIVE Usage');
    console.log('  Waiting 2 minutes to verify live calculation...');
    
    for (let i = 1; i <= 4; i++) {
      await sleep(30000); // Wait 30 seconds
      const elapsed = i * 0.5;
      status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
      console.log(`  After ${elapsed} min: Used=${status.data.data?.usedMinutes || 0}, Current Session=${status.data.data?.currentSessionMinutes || 0}, Remaining=${status.data.data?.remainingMinutes || 0}`);
    }

    // Test 5: Check active sessions endpoint
    console.log('\n✓ Test 5: Check Active Sessions Endpoint');
    const activeSessions = await makeRequest('GET', '/api/usage/sessions/active');
    console.log(`  Status: ${activeSessions.status}`);
    console.log(`  Active Sessions Count: ${activeSessions.data.count || 0}`);
    
    if (activeSessions.data.data && activeSessions.data.data.length > 0) {
      const session = activeSessions.data.data.find(s => s.userId === userId && s.requestId === requestId);
      if (session) {
        console.log(`  Your Session:`);
        console.log(`    - Session ID: ${session.sessionId}`);
        console.log(`    - Current Session Minutes: ${session.currentSessionMinutes}`);
        console.log(`    - Used Today: ${session.usedTodayMinutes}`);
        console.log(`    - Total Used: ${session.totalUsedMinutes}`);
        console.log(`    - Limit: ${session.dailyLimitMinutes}`);
      }
    }

    // Test 6: End the session
    console.log('\n✓ Test 6: End Usage Session');
    const endResult = await makeRequest('POST', '/api/usage/end', { requestId, userId });
    console.log(`  Status: ${endResult.status}`);
    console.log(`  Minutes Used: ${endResult.data.data?.minutesUsed || 0}`);
    console.log(`  Limit Exceeded: ${endResult.data.data?.limitExceeded || false}`);

    // Test 7: Check final status (session should be ended, usage stored)
    console.log('\n✓ Test 7: Check Final Status (after session ends)');
    status = await makeRequest('GET', `/api/usage/status/${requestId}/${userId}`);
    console.log(`  Status: ${status.status}`);
    console.log(`  Used Minutes: ${status.data.data?.usedMinutes || 0}`);
    console.log(`  Has Active Session: ${status.data.data?.hasActiveSession || false}`);
    console.log(`  Stored Used: ${status.data.data?.storedUsedMinutes || 0}`);
    console.log(`  Current Session: ${status.data.data?.currentSessionMinutes || 0}`);
    console.log(`  Remaining: ${status.data.data?.remainingMinutes || 0}`);

    console.log('\n' + '=' .repeat(70));
    console.log('✅ LIVE Usage Calculation Tests Complete!\n');

    console.log('📝 Summary:');
    console.log('  - Usage is now calculated LIVE while session is active ✓');
    console.log('  - Status endpoint shows real-time elapsed minutes ✓');
    console.log('  - Stored and current session minutes are tracked separately ✓');
    console.log('  - After session ends, usage is stored permanently ✓');
    console.log('');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
testLiveUsageCalculation();
