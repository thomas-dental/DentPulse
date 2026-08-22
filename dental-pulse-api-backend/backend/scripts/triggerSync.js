/**
 * Trigger sync for a specific org directly (bypasses HTTP).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { triggerSync } = require('../queue/jobQueue');
const { supabaseAdmin } = require('../config/supabase');

const ORG_ID = process.argv[2];
if (!ORG_ID) {
  console.error('Usage: node triggerSync.js <organization_id>');
  process.exit(1);
}

async function main() {
  try {
    // Look up org owner so synced records get a proper user_id
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('user_id')
      .eq('id', ORG_ID)
      .single();
    const userId = org?.user_id || null;
    console.log(`Triggering sync for org: ${ORG_ID} (user: ${userId})`);
    const result = await triggerSync(ORG_ID, null, userId);
    console.log(`Created ${result.jobCount} sync jobs`);
    console.log('Jobs will be processed by the running server. Check server logs for progress.');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
