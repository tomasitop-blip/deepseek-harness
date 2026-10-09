/** Process-local assistant attempt framing and durable stream accumulation. */

import {
  AssistantStreamAccumulator,
  BlockAssembler,
  LlmAttemptId,
  LlmError,
  type AssistantStreamRecord,
  type ContentBlock,
  type FinishReason,
  type ReplayEnvelope,
  type StreamChunk,
  type TokenUsage,
  type ToolCallBlock,
} from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { parseArguments } from './tool-calls.ts'

/** One canonical tool-call form seen in this attempt and its occurrence count. */
interface SeenToolCall {
  name: string
  arguments: unknown
  count: number
}

/** Folds one model attempt into one compact stream plus ordered transient frames. */
export class AssistantStreamAttempt {
  private readonly accumulator = new AssistantStreamAccumulator()
  private readonly assembler = new BlockAssembler()
  private index = 0
  private terminal = false
  /** Canonical tool-call forms counted toward the repetition trip. */
  private readonly seenToolCalls: SeenToolCall[] = []
  /** Attempt identity unique within this Agent lifecycle. */
  readonly attemptId: LlmAttemptId

  /** Whether this started attempt has emitted its terminal frame. */
  get ended(): boolean { return this.terminal }

  /**
   * @param sessionId - identity embedded only in the Agent-lifecycle-local attempt id.
   * @param attempt - attached-Session-local attempt counter.
   * @param nextRevision - allocates the next emitted frame revision.
   * @param turn - durable turn owning the request.
   * @param step - durable step owning the request.
   * @param emit - agent-scoped notification publisher.
   * @param repeatToolCallThreshold - occurrences of one canonical tool-call form
   *   within this attempt at which {@link push} refuses the stream.
   */
  constructor(
    sessionId: SessionId,
    attempt: number,
    private readonly nextRevision: () => number,
    readonly turn: number,
    readonly step: number,
    private readonly emit: (frame: AssistantStreamFrame) => void,
    private readonly repeatToolCallThreshold: number,
  ) {
    this.attemptId = LlmAttemptId(`${sessionId}:${attempt}`)
  }

  /** Publish the opening marker before the first delivered chunk. */
  start(): void {
    this.emit({
      type: 'start',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      turn: this.turn,
      step: this.step,
    })
  }

  /** Snapshot one chunk once, then feed durable compaction, assembly, live publication, and the repetition trip. */
  push(chunk: StreamChunk): void {
    const timed = this.accumulator.push({ time: Date.now(), chunk })
    this.assembler.push(timed.chunk)
    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') this.countToolCall(chunk.block)
    this.emit({
      type: 'chunk',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index++,
      time: timed.time,
      chunk: timed.chunk,
    })
  }

  /**
   * Count one completed tool-call block toward its canonical form and refuse
   * the stream when a form reaches this attempt's threshold. A repetition
   * storm never executes anything, so it is stopped here rather than at the
   * per-step cap, which only sees a committed message.
   * @param block - the completed tool-call block from `block-end`.
   * @throws LlmError when one canonical (name, arguments) form reaches the threshold.
   */
  private countToolCall(block: ToolCallBlock): void {
    const argumentsValue = parseArguments(block.arguments)
    const form = this.seenToolCalls.find(
      seen => seen.name === block.name && deepEqualJson(seen.arguments, argumentsValue),
    )
    if (form === undefined) {
      this.seenToolCalls.push({ name: block.name, arguments: argumentsValue, count: 1 })
      return
    }
    form.count += 1
    if (form.count >= this.repeatToolCallThreshold) {
      throw new LlmError(
        `assistant stream repeated tool call "${block.name}" with identical arguments ${form.count} times in one attempt`
        + ` (repeatToolCallThreshold is ${this.repeatToolCallThreshold}): stop repeating the same call and choose a different action,`
        + ' or raise the agent-loop repeatToolCallThreshold configuration',
        'REPEATED_TOOL_CALLS_EXCEEDED',
      )
    }
  }

  /**
   * Publish terminal settlement after the matching durable event commits.
   * @param eventType - durable settlement type.
   * @param append - synchronous durable append returning its committed seq.
   */
  settle(
    eventType: 'assistant/message' | 'assistant/attempt',
    append: () => SessionSeq,
  ): void {
    let seq: SessionSeq
    try {
      seq = append()
    } catch (error: unknown) {
      this.abandon()
      throw error
    }
    this.terminal = true
    this.emit({
      type: 'end',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index,
      outcome: { kind: 'committed', eventType, seq },
    })
  }

  /** Publish abandonment when no durable attempt event can be committed. */
  abandon(): void {
    this.terminal = true
    this.emit({
      type: 'end',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index,
      outcome: { kind: 'abandoned' },
    })
  }

  /** Exact compact stream for the final durable event. */
  get stream(): SessionEventMap['assistant/attempt']['stream'] {
    return [...this.accumulator.snapshot()] as AssistantStreamRecord[]
  }

  /** Canonical completed-message blocks from the same chunks. */
  blocks(): ContentBlock[] {
    return this.assembler.blocks()
  }

  /** Safe visible prefix when cancellation interrupts the attempt. */
  interruptedBlocks(): ContentBlock[] {
    return this.assembler.interruptedBlocks()
  }

  /** Latest adapter-reported usage in the stream. */
  get usage(): TokenUsage | undefined {
    return this.assembler.usage
  }

  /** Terminal reason, defaulting to stop when the stream omitted one. */
  get finish(): FinishReason {
    return this.assembler.finish
  }

  /** Replay state carried by the terminal finish record. */
  get replayState(): ReplayEnvelope | undefined {
    return this.assembler.replayState
  }
}
