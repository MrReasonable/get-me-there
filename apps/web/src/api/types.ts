import type { apiContract, ResultBasis } from '@gmt/core';
import type { z } from 'zod';

// why: core already exports these inferred contract types (decision 17); one import site per type.
export type { BudgetFit, CoverageCheckResponse, DefinitionResponse, ResultRow } from '@gmt/core';

/** Response types: the z.output of each contract schema (plan "API contract"). */
export type ProvidersResponse = z.output<typeof apiContract.providersResponseSchema>;
export type Estimate = z.output<typeof apiContract.estimateSchema>;
export type EstimateResponse = z.output<typeof apiContract.estimateResponseSchema>;
export type ExecutionResponse = z.output<typeof apiContract.executionResponseSchema>;
export type ResultsResponse = z.output<typeof apiContract.resultsResponseSchema>;
export type ExecutionSummary = z.output<typeof apiContract.executionSummarySchema>;
export type CoverageResponse = z.output<typeof apiContract.coverageResponseSchema>;
export type CalendarGapResponse = z.output<typeof apiContract.calendarGapResponseSchema>;
export type AirportsResponse = z.output<typeof apiContract.airportsResponseSchema>;
export type PriceCellData = z.output<typeof apiContract.priceCellSchema>;
export type UsageRow = z.output<typeof apiContract.usageSchema>;
export type SearchCard = z.output<typeof apiContract.searchCardSchema>;
export type Basis = ResultBasis;

/**
 * Request bodies in the schema's *input* shape: plain strings where the output has brands. The
 * operator's draft is unvalidated until the API parses it (spec §6.1), so the web never mints a brand.
 */
export type DefinitionBody = z.input<typeof apiContract.definitionCreateRequestSchema>;
export type DefinitionUpdateBody = z.input<typeof apiContract.definitionUpdateRequestSchema>;
export type CoverageCheckBody = z.input<typeof apiContract.coverageCheckRequestSchema>;
export type VerifyCellBody = z.input<typeof apiContract.verifyCellRequestSchema>;
export type StartExecutionBody = z.input<typeof apiContract.startExecutionRequestSchema>;
/** Search now's one press (spec rev 55 §10 `POST /definitions/create-and-start`), in the schema's input shape. */
export type CreateAndStartBody = z.input<typeof apiContract.createAndStartRequestSchema>;
export type CreateAndStartResponse = z.output<typeof apiContract.createAndStartResponseSchema>;
/** A refused start in the create-and-start answer: its code (worded by the web) and the figures the words need. */
export type StartRefusal = NonNullable<CreateAndStartResponse['refusal']>;

// WP10 routes (plan "API contract", results.ts, with WP10's additions of decisions 38, 42 and 48).
export type CellDetailResponse = z.output<typeof apiContract.cellDetailResponseSchema>;
export type ItineraryHistoryResponse = z.output<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.output<typeof apiContract.routeHistoryResponseSchema>;

/**
 * The date-pairs route's scope (spec §10, WP19): its wire form, every value a string or absent. Built by datesState's
 * `scopeQuery`, sorted so one scope is one query key.
 */
export interface DatePairsScope {
  origins: string | undefined;
  destinations: string | undefined;
  maxJourneyMinutes: string | undefined;
}

/** An alert rule as the form sends it: the schema's input shape (cooldownHours may be left to its default of 336). */
export type AlertRuleBody = z.input<typeof apiContract.alertRuleInputSchema>;

/** WP20 Task 20.10 (spec rev 55 §10): a search's page's flight lists, and one stored list. */
export type FlightListsResponse = z.output<typeof apiContract.flightListsResponseSchema>;
export type FlightList = z.output<typeof apiContract.flightListSchema>;

/** The trip read's query: the scope's wire form (`tripQuerySchema`). */
export type TripQuery = z.input<typeof apiContract.tripQuerySchema>;

/** Design 2026-11-08 §6.1: one trip's dates in one call (`GET /definitions/:id/trip`). */
export type TripResponse = z.output<typeof apiContract.tripResponseSchema>;

/** `GET /budget`: every scope's usage and the month's cap. */
export type BudgetResponse = z.output<typeof apiContract.budgetResponseSchema>;
