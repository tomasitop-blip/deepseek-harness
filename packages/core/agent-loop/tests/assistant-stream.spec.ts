/**
 * Direct seam tests for the in-stream repetition trip: `AssistantStreamAttempt`
 * must refuse a stream that repeats one canonical tool-call form.
 */

import { describe, expect, it } from 'vitest'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AssistantStreamAttempt } from '../src/assistant-stream.ts'

/** One tool-call block as a start/end chunk pair, with a unique call id. */
function toolCallChunks(id: string, name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
  ]
}

/** A fresh attempt with the given threshold; frames are collected, revision is sequential. */
function makeAttempt(repeatToolCallThreshold: number): AssistantStreamAttempt {
  let revision = 0
  const _frames: AssistantStreamFrame[] = []
  return new AssistantStreamAttempt(
    SessionId('storm-session'),
    1,
    () => ++revision,
    1,
    1,
    (frame) => { _frames.push(frame) },
    repeatToolCallThreshold,
  )
}

function drain(attempt: AssistantStreamAttempt, chunks: StreamChunk[]): void {
  for (const chunk of chunks) attempt.push(chunk)
}

/**
 * A block stream shaped from the recorded 4843-block storm: 91 distinct
 * argument objects, one form repeated 563 times, every call id unique.
 */
function stormChunks(): StreamChunk[] {
  const chunks: StreamChunk[] = []
  const distinct: object[] = Array.from({ length: 90 }, (_unused, index) => ({ pattern: `dir-${index}/**` }))
  const dominant = { pattern: 'ui/README*' }
  let dominantEmitted = 0
  let distinctEmitted = 0
  for (let index = 0; index < 4843; index++) {
    const args = index < 90
      ? distinct[index]!
      : dominantEmitted < 563 && index % 8 === 0
        ? (dominantEmitted++, dominant)
        : distinct[distinctEmitted++ % 90]!
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id: ToolCallId(`call-${index}`), name: 'glob', arguments: JSON.stringify(args) },
      },
    )
  }
  return chunks
}

describe('AssistantStreamAttempt repetition trip', () => {
  it('trips mid-storm on a 4843-block stream with 91 distinct argument forms', () => {
    const attempt = makeAttempt(8)
    const chunks = stormChunks()
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toHaveLength(4843)

    expect(() => { drain(attempt, chunks) }).toThrow(/repeatToolCallThreshold/)
  })

  it('never trips when every argument form is distinct', () => {
    const attempt = makeAttempt(8)
    for (let index = 0; index < 300; index++) {
      drain(attempt, toolCallChunks(`call-${index}`, 'glob', { pattern: `unique-${index}` }))
    }

    expect(attempt.ended).toBe(false)
  })

  it('trips at the threshold and not before, counting canonical forms across key order', () => {
    const attempt = makeAttempt(3)

    drain(attempt, toolCallChunks('c1', 'glob', { pattern: 'a', path: 'b' }))
    drain(attempt, toolCallChunks('c2', 'glob', { path: 'b', pattern: 'a' }))

    expect(() => { drain(attempt, toolCallChunks('c3', 'glob', { pattern: 'a', path: 'b' })) })
      .toThrow(/repeated tool call "glob" with identical arguments 3 times/)
  })

  it('a second attempt after a trip starts from a clean count', () => {
    const tripped = makeAttempt(3)
    const identical = toolCallChunks('c1', 'glob', { pattern: 'a' })
    expect(() => { drain(tripped, [...identical, ...identical, ...identical]) }).toThrow()

    const fresh = makeAttempt(3)
    drain(fresh, [...identical, ...identical])

    expect(fresh.ended).toBe(false)
  })
})
