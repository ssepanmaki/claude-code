import type { Command } from '../../types/command.js'

const workflows = {
  type: 'local-jsx',
  name: 'workflows',
  description:
    'Workflow monitoring panel: live run/phase/agent progress, keyboard controls',
  // Lazy-load the panel implementation to avoid pulling in Ink/React dependencies at startup.
  load: () => import('../../workflow/panel/panelCall.js'),
} satisfies Command

export default workflows
