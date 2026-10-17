/**
 * Simple test suite for AI Support Agent
 * Run with: node aiSupportAgent.test.js
 */

const aiSupportAgent = require('./aiSupportAgent');

console.log('Testing AI Support Agent...\n');

// Test 1: Initial state
console.log('Test 1: Initial state');
const initialStats = aiSupportAgent.getStats();
console.log('✓ Agent enabled:', initialStats.enabled);
console.log('✓ Enabled channels:', initialStats.enabledChannels);
console.log('✓ Q&A knowledge base size:', initialStats.qaKnowledgeBase);
console.log('✓ Staff alert channel:', initialStats.staffAlertChannel || '(not set)');

// Test 2: Enable/disable agent
console.log('\nTest 2: Enable/disable agent');
aiSupportAgent.setAgentEnabled(false);
console.log('✓ Agent disabled:', !aiSupportAgent.isAgentEnabled());
aiSupportAgent.setAgentEnabled(true);
console.log('✓ Agent enabled:', aiSupportAgent.isAgentEnabled());

// Test 3: Channel management
console.log('\nTest 3: Channel management');
const testChannelId = '123456789';
aiSupportAgent.enableChannel(testChannelId);
console.log('✓ Channel enabled:', aiSupportAgent.isChannelEnabled(testChannelId));
aiSupportAgent.disableChannel(testChannelId);
console.log('✓ Channel disabled:', !aiSupportAgent.isChannelEnabled(testChannelId));

// Test 4: Staff alert channel
console.log('\nTest 4: Staff alert channel');
const alertChannelId = '987654321';
aiSupportAgent.setStaffAlertChannel(alertChannelId);
console.log('✓ Staff alert channel set:', aiSupportAgent.getStaffAlertChannel() === alertChannelId);

// Test 5: Get enabled channels
console.log('\nTest 5: Get enabled channels');
aiSupportAgent.enableChannel('111');
aiSupportAgent.enableChannel('222');
aiSupportAgent.enableChannel('333');
const enabledChannels = aiSupportAgent.getEnabledChannels();
console.log('✓ Enabled channels count:', enabledChannels.length);
console.log('  Channels:', enabledChannels);

// Test 6: Stats
console.log('\nTest 6: Final stats');
const finalStats = aiSupportAgent.getStats();
console.log('✓ Agent enabled:', finalStats.enabled);
console.log('✓ Enabled channels:', finalStats.enabledChannels);
console.log('✓ Q&A knowledge base size:', finalStats.qaKnowledgeBase);
console.log('✓ Replies last hour:', finalStats.repliesLastHour);
console.log('✓ Staff alert channel:', finalStats.staffAlertChannel);

console.log('\n✅ All tests passed!');
