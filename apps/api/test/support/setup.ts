// Vitest setup for @gmt/api (plan decisions 18 and 20): WP4's network guards — a catch-all msw handler that
// fails the test on any request no stand-in answered, and DNS lookups refused for the whole run. apps/api never
// imports msw itself; vendor stand-ins replace globalThis.fetch (test/helpers/vendors.ts).
import { installNetworkGuards } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';

installNetworkGuards({ beforeAll, afterEach, afterAll });
