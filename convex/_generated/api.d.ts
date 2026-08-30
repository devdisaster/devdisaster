/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cluster from "../cluster.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as devin from "../devin.js";
import type * as docs from "../docs.js";
import type * as http from "../http.js";
import type * as incidents from "../incidents.js";
import type * as ingest from "../ingest.js";
import type * as seed from "../seed.js";
import type * as threshold from "../threshold.js";
import type * as vendor from "../vendor.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cluster: typeof cluster;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demo: typeof demo;
  devin: typeof devin;
  docs: typeof docs;
  http: typeof http;
  incidents: typeof incidents;
  ingest: typeof ingest;
  seed: typeof seed;
  threshold: typeof threshold;
  vendor: typeof vendor;
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

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
