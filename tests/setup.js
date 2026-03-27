/**
 * Jest setup file for all tests
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ quiet: true });

// Set test timeout globally (only if jest is available)
if (typeof jest !== 'undefined') {
  jest.setTimeout(30000);
}

// Global test helpers
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
