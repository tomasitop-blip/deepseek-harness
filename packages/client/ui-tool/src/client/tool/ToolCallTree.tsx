/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ChatNode, ChatSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallOwnerProps, ToolCallPhaseProps, ToolTreeProps } from '../contract/slots.ts'
import { toolRowModel } from './models/tool-call-model.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/**
 * A preparing call is queued once its own step's Assistant message has
 * settled: the call is committed and waiting behind the exclusive Tool
 * barrier while the model has finished the attempt. Streaming steps and
 * unmatched turn/step pairs stay in preparation.
 */
function stepSettled(snapshot: ChatSnapshot, block: ToolCallBlock): boolean {
  if ('kind' in block || block.phase !== 'preparing') return false
  const keys = snapshot.locations.getStep(block.turn, block.step)
  for (const key of keys) {
    const node = snapshot.nodes.get(key) as ChatNode | undefined
    if (node?.kind === 'assistant-step' && node.data.status === 'settled') return true
  }
  return false
}

function toolCallPhase(block: ToolCallBlock, queued: boolean): ToolCallPhaseProps {
  if ('kind' in block) return { phase: 'result', block }
  if (block.phase === 'preparing') return queued ? { phase: 'queued', block } : { phase: 'preparing', block }
  return { phase: 'start', block }
}

/** Resolve a Tool call's wire name from its current stage. */
function callName(call: ToolCallPhaseProps): string {
  return call.phase === 'result' ? call.block.call?.name ?? '' : call.block.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, call, openFile, cwd, home, inspectCall, loadImage, useDisclosure, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 't'> & {
  callId: string
  toolName: string
  call: ToolCallPhaseProps
  home?: string | undefined
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    ...call,
    openFile,
    cwd,
    home,
    loadImage,
    useDisclosure,
    inspect: inspectCall === undefined ? undefined : () => { inspectCall(callId) },
  }), [callId, toolName, call, openFile, cwd, home, loadImage, inspectCall, useDisclosure])
  const autoReviewDenied = useMemo(
    () => call.phase === 'result' && toolRowModel(toolName, call.block).autoReviewDenial !== null,
    [toolName, call],
  )
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
    >
      {autoReviewDenied
        ? <GenericToolCard {...owner} t={t} />
        : renderSlot('tool.call.toolview', owner, {
          entryKey: toolName,
          fallback: <GenericToolCard {...owner} t={t} />,
        })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, cwd, home, openFile, inspectCall, loadImage, useDisclosure, useChat, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'cwd' | 'openFile' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 'useChat' | 't'> & {
  block: ToolCallBlock
  home?: string | undefined
}) {
  const queued = useChat(snapshot => stepSettled(snapshot, block))
  const call = useMemo(() => toolCallPhase(block, queued), [block, queued])
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={call.block.callId}
      toolName={callName(call)}
      call={call}
      openFile={openFile}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      loadImage={loadImage}
      t={t}
    >
      {call.phase !== 'preparing' && call.phase !== 'queued' && call.block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {call.block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              useDisclosure={useDisclosure}
              useChat={useChat}
              loadImage={loadImage}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, cwd, openFile, inspectCall, loadImage, useDisclosure, useHostInfo, useChat, t,
}: ToolTreeProps) {
  const home = useHostInfo(info => info.home)
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={node.data.root}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      useChat={useChat}
      loadImage={loadImage}
      t={t}
    />
  )
}
