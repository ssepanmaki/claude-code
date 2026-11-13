import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

// ─── Mocks (only mock the dependency chain with side effects) ───

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

mock.module('src/constants/xml.js', () => ({
  TASK_NOTIFICATION_TAG: 'task_notification',
  TASK_ID_TAG: 'task_id',
  TOOL_USE_ID_TAG: 'tool_use_id',
  OUTPUT_FILE_TAG: 'output_file',
  STATUS_TAG: 'status',
  SUMMARY_TAG: 'summary',
  WORKTREE_TAG: 'worktree',
  WORKTREE_PATH_TAG: 'worktree_path',
  WORKTREE_BRANCH_TAG: 'worktree_branch',
  TASK_TYPE_TAG: 'task_type',
}))

mock.module('src/utils/messageQueueManager.js', () => ({
  enqueuePendingNotification: () => {},
}))

mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: () => {},
}))

mock.module('src/utils/task/diskOutput.js', () => ({
  getTaskOutputDelta: async () => null,
  getTaskOutputPath: (id: string) => `/tmp/${id}`,
  evictTaskOutput: () => {},
  initTaskOutputAsSymlink: async () => {},
}))

// ─── Import after mocks ───

const { registerLocalWorkflowTask, failWorkflowTask } = await import(
  '../LocalWorkflowTask.js'
)

// ─── Helpers ───

type AppStateLike = { tasks: Record<string, any> }
type SetAppStateLike = (f: (prev: AppStateLike) => AppStateLike) => void

function createSetState(): {
  setAppState: SetAppStateLike
  getState: () => AppStateLike
} {
  let state: AppStateLike = { tasks: {} }
  return {
    setAppState: f => {
      state = f(state)
    },
    getState: () => state,
  }
}

// ─── Tests ───

describe('failWorkflowTask', () => {
  test('saves the error string into state (for BackgroundTasksDialog to show the failure reason)', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    failWorkflowTask(taskId, setAppState as any, 'agent X threw Error: boom')
    const task = getState().tasks[taskId]
    expect(task.status).toBe('failed')
    expect(task.error).toBe('agent X threw Error: boom')
  })

  test('state.error stays undefined when no error is passed (backward compatible with existing callers)', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    failWorkflowTask(taskId, setAppState as any)
    const task = getState().tasks[taskId]
    expect(task.status).toBe('failed')
    expect(task.error).toBeUndefined()
  })
})
