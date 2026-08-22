/**
 * List all incomplete sync jobs (queued or running)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { supabaseAdmin } = require('../config/supabase');

async function listIncompleteJobs() {
  console.log('Fetching incomplete jobs...\n');

  const { data: jobs, error } = await supabaseAdmin
    .from('sync_jobs')
    .select('id, entity_alias, status, start_date, end_date, organization_id, created_at, retry_count, progress_percentage, records_processed, error_message')
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching jobs:', error.message);
    return;
  }

  console.log(`Found ${jobs.length} incomplete jobs:\n`);

  if (jobs.length === 0) {
    console.log('No incomplete jobs found.');
    return;
  }

  // Group by status
  const queued = jobs.filter(j => j.status === 'queued');
  const running = jobs.filter(j => j.status === 'running');

  console.log(`\n📋 QUEUED JOBS (${queued.length}):`);
  console.log('─'.repeat(120));
  queued.forEach((job, idx) => {
    const dateRange = job.start_date ? ` [${job.start_date.substring(0, 7)}]` : '';
    console.log(`${idx + 1}. ${job.id}`);
    console.log(`   Entity: ${job.entity_alias}${dateRange}`);
    console.log(`   Progress: ${job.progress_percentage || 0}% | Processed: ${job.records_processed || 0}`);
    console.log(`   Retries: ${job.retry_count || 0}/3`);
    if (job.error_message) {
      console.log(`   Last Error: ${job.error_message.substring(0, 80)}...`);
    }
    console.log('');
  });

  if (running.length > 0) {
    console.log(`\n⚙️  RUNNING JOBS (${running.length}):`);
    console.log('─'.repeat(120));
    running.forEach((job, idx) => {
      const dateRange = job.start_date ? ` [${job.start_date.substring(0, 7)}]` : '';
      console.log(`${idx + 1}. ${job.id}`);
      console.log(`   Entity: ${job.entity_alias}${dateRange}`);
      console.log(`   Progress: ${job.progress_percentage || 0}% | Processed: ${job.records_processed || 0}`);
      console.log('');
    });
  }

  // Export just IDs
  console.log('\n\n📄 ALL IDS (for copy-paste):');
  console.log('─'.repeat(120));
  jobs.forEach(job => console.log(job.id));

  // Export as JSON array
  console.log('\n\n📄 JSON ARRAY (for scripts):');
  console.log('─'.repeat(120));
  console.log(JSON.stringify(jobs.map(j => j.id), null, 2));

  // Summary by entity
  console.log('\n\n📊 SUMMARY BY ENTITY:');
  console.log('─'.repeat(120));
  const byEntity = jobs.reduce((acc, job) => {
    acc[job.entity_alias] = (acc[job.entity_alias] || 0) + 1;
    return acc;
  }, {});

  Object.entries(byEntity)
    .sort((a, b) => b[1] - a[1])
    .forEach(([entity, count]) => {
      console.log(`  ${entity}: ${count} jobs`);
    });
}

listIncompleteJobs().catch(console.error);
