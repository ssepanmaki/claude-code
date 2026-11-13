import { describe, expect, test } from 'bun:test'
import { extractQueryFromMessages } from '../prefetch.js'
import type { Message } from '../../../types/message.js'

function userText(text: string): Message {
  return { type: 'user', content: text } as unknown as Message
}

function userTextBlocks(text: string): Message {
  return {
    type: 'user',
    content: [{ type: 'text', text }],
  } as unknown as Message
}

function userToolResult(id: string): Message {
  return {
    type: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'output' }],
  } as unknown as Message
}

function assistantText(text: string): Message {
  return { type: 'assistant', content: text } as unknown as Message
}

describe('extractQueryFromMessages — inter-turn pass-through logic', () => {
  test('null input + messages end with tool_result → pass through to the real user text', () => {
    const messages: Message[] = [
      userText('study the current code'),
      assistantText('calling a tool'),
      userToolResult('tool_01'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('study the current code')
  })

  test('null input + messages end with a user text block → extracted correctly', () => {
    const messages: Message[] = [
      userTextBlocks('refactor the auth module'),
      assistantText('thinking...'),
      userToolResult('tool_02'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('refactor the auth module')
  })

  test('null input + several consecutive rounds of tool_result → keep looking back to the earliest user text', () => {
    const messages: Message[] = [
      userText('study the current code'),
      assistantText('first call'),
      userToolResult('tool_a'),
      assistantText('second call'),
      userToolResult('tool_b'),
      assistantText('third call'),
      userToolResult('tool_c'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('study the current code')
  })

  test('null input + empty messages → empty string', () => {
    const query = extractQueryFromMessages(null, [])
    expect(query).toBe('')
  })

  test('null input + all tool_result (no real text) → empty string', () => {
    const messages: Message[] = [
      userToolResult('tool_a'),
      userToolResult('tool_b'),
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('')
  })

  test('string input + null messages → returns only the input', () => {
    const query = extractQueryFromMessages('hello world', [])
    expect(query).toBe('hello world')
  })

  test('string input + user text present → the two are concatenated', () => {
    const messages: Message[] = [userText('previous query')]
    const query = extractQueryFromMessages('new query', messages)
    expect(query).toContain('new query')
    expect(query).toContain('previous query')
  })

  test('overlong user text is truncated to 500 characters', () => {
    const longText = 'a'.repeat(1000)
    const messages: Message[] = [userText(longText)]
    const query = extractQueryFromMessages(null, messages)
    expect(query.length).toBe(500)
  })

  test('tool_result with a text field (but type=tool_result) → must be skipped, never misused', () => {
    const messages: Message[] = [
      userText('real query'),
      {
        type: 'user',
        content: [
          {
            type: 'tool_result',
            text: 'this is tool output masquerading as text',
          },
        ],
      } as unknown as Message,
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('real query')
  })

  test('empty-string text in the user content array → skip the empty text and keep looking', () => {
    const messages: Message[] = [
      userText('real query'),
      {
        type: 'user',
        content: [{ type: 'text', text: '   ' }],
      } as unknown as Message,
    ]
    const query = extractQueryFromMessages(null, messages)
    expect(query).toBe('real query')
  })
})
