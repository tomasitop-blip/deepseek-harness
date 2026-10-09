/** Shared agent-loop configuration defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default maximum tool calls one assistant step may carry before the turn fails. */
export const DEFAULT_MAX_TOOL_CALLS_PER_STEP = 64

/** Default occurrences of one canonical tool-call form within one attempt before the stream trips. */
export const DEFAULT_REPEAT_TOOL_CALL_THRESHOLD = 8
