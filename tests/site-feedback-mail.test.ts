import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smtpFailure, feedbackMailRetrySeconds } from '../app/lib/siteFeedbackMail.ts';

test('only known transient SMTP errors are eligible for retries', () => {
  for (const error of [
    { responseCode: 451, code: 'EMESSAGE' },
    { responseCode: 454, code: 'EAUTH' },
    { code: 'ETIMEDOUT', timeoutType: 'GREETING_TIMEOUT' },
    { code: 'ESOCKET', originalCode: 'ECONNREFUSED' },
  ]) assert.equal(smtpFailure(error), 'retry');
  assert.equal(smtpFailure({ responseCode: 550 }), 'failed');
  assert.equal(smtpFailure({ code: 'EAUTH' }), 'failed');
  assert.equal(smtpFailure({ code: 'ESOCKET', command: 'CONN' }), 'unknown');
  assert.equal(smtpFailure(new Error('Socket closed after DATA')), 'unknown');
});

test('feedback mail makes one initial attempt and at most three retries', () => {
  assert.deepEqual([1, 2, 3, 4].map(feedbackMailRetrySeconds), [60, 300, 900, undefined]);
});
