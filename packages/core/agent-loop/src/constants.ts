/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default maximum tool calls one assistant step may carry before the turn fails. */
export const DEFAULT_MAX_TOOL_CALLS_PER_STEP = 64
