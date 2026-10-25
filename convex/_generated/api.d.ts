/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentData from "../agentData.js";
import type * as backtest from "../backtest.js";
import type * as backtestRun from "../backtestRun.js";
import type * as crs from "../crs.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as nessie from "../nessie.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentData: typeof agentData;
  backtest: typeof backtest;
  backtestRun: typeof backtestRun;
  crs: typeof crs;
  dashboard: typeof dashboard;
  demo: typeof demo;
  nessie: typeof nessie;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
