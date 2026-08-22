/**
 * Sync module entry point.
 * Exports the public API for both the Dentally and Iplicit sync systems.
 */

const jobQueue       = require('./jobQueue');
const iplicitJobQueue = require('./iplicit/jobQueue');
const xeroJobQueue    = require('./xero/jobQueue');
const quickbooksJobQueue = require('./quickbooks/jobQueue');

module.exports = {
  // Dentally queue
  initialize:      jobQueue.initialize,
  triggerSync:     jobQueue.triggerSync,
  resumeQueuedJobs: jobQueue.resumeQueuedJobs,
  cancelJob:       jobQueue.cancelJob,
  cancelAllJobs:   jobQueue.cancelAllJobs,
  cancelJobsForIntegration: jobQueue.cancelJobsForIntegration,
  getQueueStats:   jobQueue.getQueueStats,
  sweepStaleJobs:  jobQueue.sweepStaleJobs,
  shutdown:        jobQueue.shutdown,

  // Iplicit queue
  iplicit: {
    initialize:      iplicitJobQueue.initialize,
    triggerSync:     iplicitJobQueue.triggerSync,
    resumeQueuedJobs: iplicitJobQueue.resumeQueuedJobs,
    cancelJob:       iplicitJobQueue.cancelJob,
    cancelAllJobs:   iplicitJobQueue.cancelAllJobs,
    getQueueStats:   iplicitJobQueue.getQueueStats,
    shutdown:        iplicitJobQueue.shutdown,
  },

  // Xero queue
  xero: {
    initialize:      xeroJobQueue.initialize,
    triggerSync:     xeroJobQueue.triggerSync,
    resumeQueuedJobs: xeroJobQueue.resumeQueuedJobs,
    cancelJob:       xeroJobQueue.cancelJob,
    cancelAllJobs:   xeroJobQueue.cancelAllJobs,
    getQueueStats:   xeroJobQueue.getQueueStats,
    shutdown:        xeroJobQueue.shutdown,
  },

  // QuickBooks queue
  quickbooks: {
    initialize:      quickbooksJobQueue.initialize,
    triggerSync:     quickbooksJobQueue.triggerSync,
    resumeQueuedJobs: quickbooksJobQueue.resumeQueuedJobs,
    cancelJob:       quickbooksJobQueue.cancelJob,
    cancelAllJobs:   quickbooksJobQueue.cancelAllJobs,
    getQueueStats:   quickbooksJobQueue.getQueueStats,
    shutdown:        quickbooksJobQueue.shutdown,
  },
};
