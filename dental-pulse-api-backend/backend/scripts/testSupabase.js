/**
 * Test Supabase connection and diagnose issues
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { supabaseAdmin } = require('../config/supabase');

async function testConnection() {
  console.log('Testing Supabase connection...\n');

  // Test 1: Check environment variables
  console.log('✓ Environment Variables:');
  console.log(`  VITE_SUPABASE_URL: ${process.env.VITE_SUPABASE_URL ? 'Set' : 'Missing'}`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set (first 20 chars: ' + process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20) + '...)' : 'Missing'}\n`);

  // Test 2: Simple select query
  console.log('Test 1: Simple SELECT query...');
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .limit(1);

    if (error) {
      console.error('✗ SELECT failed:', error.message);
      console.error('  Error details:', error);
    } else {
      console.log('✓ SELECT successful! Found', data?.length || 0, 'records\n');
    }
  } catch (err) {
    console.error('✗ SELECT exception:', err.message);
    console.error('  Full error:', err);
  }

  // Test 3: Check if sync_jobs table exists
  console.log('Test 2: Check sync_jobs table...');
  try {
    const { data, error } = await supabaseAdmin
      .from('sync_jobs')
      .select('id')
      .limit(1);

    if (error) {
      console.error('✗ sync_jobs query failed:', error.message);
      if (error.code === '42P01') {
        console.error('  → Table does not exist!');
      }
    } else {
      console.log('✓ sync_jobs table exists! Found', data?.length || 0, 'records\n');
    }
  } catch (err) {
    console.error('✗ Exception:', err.message);
  }

  // Test 4: Check integrations table
  console.log('Test 3: Check integrations table...');
  try {
    const { data, error } = await supabaseAdmin
      .from('integrations')
      .select('id, organization_id, integration_name')
      .limit(5);

    if (error) {
      console.error('✗ integrations query failed:', error.message);
    } else {
      console.log('✓ integrations table exists! Found', data?.length || 0, 'integrations');
      if (data && data.length > 0) {
        console.log('  Integrations:');
        data.forEach(int => console.log(`    - ${int.id} (${int.integration_name}) - Org: ${int.organization_id}`));
      }
      console.log();
    }
  } catch (err) {
    console.error('✗ Exception:', err.message);
  }

  // Test 5: Test upsert to treatment_appointments
  console.log('Test 4: Test UPSERT to treatment_appointments...');
  try {
    const testRecord = {
      organization_id: '00000000-0000-0000-0000-000000000000', // Dummy UUID
      external_id: 'test-' + Date.now(),
      appointment_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('treatment_appointments')
      .upsert(testRecord, { onConflict: 'external_id' });

    if (error) {
      console.error('✗ UPSERT failed:', error.message);
      console.error('  Error code:', error.code);
      console.error('  Error details:', error.details);

      if (error.code === '42P01') {
        console.error('  → Table "treatment_appointments" does not exist!');
      } else if (error.code === '23503') {
        console.error('  → Foreign key constraint violation (expected with dummy data)');
      } else if (error.message.includes('fetch failed')) {
        console.error('  → Network/connection issue - check firewall, SSL, or proxy settings');
      }
    } else {
      console.log('✓ UPSERT successful!\n');

      // Clean up test record
      await supabaseAdmin
        .from('treatment_appointments')
        .delete()
        .eq('external_id', testRecord.external_id);
      console.log('✓ Cleaned up test record\n');
    }
  } catch (err) {
    console.error('✗ Exception during UPSERT:', err.message);
    console.error('  Full error:', err);
  }

  console.log('Diagnostic complete!');
}

testConnection().catch(console.error);
