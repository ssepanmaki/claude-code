import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import { Dialog } from '@anthropic/ink';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isSkillLearningEnabled } from '../../services/skillLearning/featureCheck.js';

type SkillAction = {
  label: string;
  description: string;
  run: () => Promise<string>;
};

const ACTION_LABEL_COLUMN_WIDTH = 28;

const ABOUT_TEXT = `# Skill Learning (automatic learning)

Skill Learning is a closed-loop learning system that automatically extracts instincts by observing the user's action patterns,
and once a threshold is reached it generates reusable skill files, agents and commands.

## Workflow
1. **Observe** — record tool calls, user corrections and error-resolution patterns in each conversation turn
2. **Analyze** — analyze the observations with a heuristic or LLM backend to extract instinct candidates
3. **Evolve** — cluster high-confidence instincts and generate skill/agent/command candidates
4. **Lifecycle** — dedupe, version-compare, archive or replace the generated skills

## Subcommands
- /skill-learning status       — show the observation and instinct counts for the current project
- /skill-learning ingest       — import observations from the transcript
- /skill-learning evolve       — generate skill candidates (--generate writes to disk)
- /skill-learning export       — export instincts as JSON
- /skill-learning import       — import instinct JSON
- /skill-learning prune        — clean up expired pending instincts
- /skill-learning promote      — promote an instinct/gap to global scope
- /skill-learning projects     — list all known project scopes

## How to enable
- SKILL_LEARNING_ENABLED=1 or FEATURE_SKILL_LEARNING=1
- Status: ${isSkillLearningEnabled() ? 'enabled' : 'disabled'}
`;

async function getStatusText(): Promise<string> {
  const { readObservations, loadInstincts, resolveProjectContext } = await import(
    '../../services/skillLearning/index.js'
  );
  const project = resolveProjectContext(process.cwd());
  const [observations, instincts] = await Promise.all([readObservations({ project }), loadInstincts({ project })]);
  return [
    `Skill Learning status for ${project.projectName} (${project.projectId})`,
    `Observations: ${observations.length}`,
    `Instincts: ${instincts.length}`,
    '',
    `Skill Learning: ${isSkillLearningEnabled() ? 'enabled' : 'disabled'}`,
  ].join('\n');
}

async function startSkillLearning(): Promise<string> {
  const lines: string[] = [];

  if (!isSkillLearningEnabled()) {
    process.env.SKILL_LEARNING_ENABLED = '1';
    lines.push('Skill Learning: enabled (SKILL_LEARNING_ENABLED=1)');
  } else {
    lines.push('Skill Learning: already enabled');
  }

  try {
    const { initSkillLearning } = await import('../../services/skillLearning/runtimeObserver.js');
    initSkillLearning();
    lines.push('Runtime observer: initialized');
  } catch {
    lines.push('Runtime observer: init skipped (not available)');
  }

  return lines.join('\n');
}

async function stopSkillLearning(): Promise<string> {
  const lines: string[] = [];

  if (isSkillLearningEnabled()) {
    process.env.SKILL_LEARNING_ENABLED = '0';
    process.env.CLAUDE_SKILL_LEARNING_DISABLE = '1';
    lines.push('Skill Learning: disabled (SKILL_LEARNING_ENABLED=0)');
  } else {
    lines.push('Skill Learning: already disabled');
  }

  return lines.join('\n');
}

function SkillPanel({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  useRegisterOverlay('skill-panel');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const actions = useMemo<SkillAction[]>(
    () => [
      {
        label: 'Status',
        description: 'Show skill learning status for current project',
        run: getStatusText,
      },
      {
        label: 'Start',
        description: 'Enable skill learning for this session',
        run: startSkillLearning,
      },
      {
        label: 'Stop',
        description: 'Disable skill learning for this session',
        run: stopSkillLearning,
      },
      {
        label: 'About',
        description: 'Detailed description of skill learning features',
        run: () => Promise.resolve(ABOUT_TEXT),
      },
    ],
    [],
  );

  const selectCurrent = () => {
    const action = actions[selectedIndex];
    if (!action) return;
    void action.run().then(result => {
      onDone(result, { display: 'system' });
    });
  };

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(index => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(index => Math.min(actions.length - 1, index + 1));
      return;
    }
    if (key.return) {
      selectCurrent();
    }
  });

  return (
    <Dialog
      title="Skill Learning"
      subtitle={`${actions.length} actions`}
      onCancel={() => onDone('Skill panel dismissed', { display: 'system' })}
      color="background"
      hideInputGuide
    >
      <Box flexDirection="column">
        {actions.map((action, index) => (
          <Box key={action.label} flexDirection="row">
            <Text>{`${index === selectedIndex ? '›' : ' '} ${action.label}`.padEnd(ACTION_LABEL_COLUMN_WIDTH)}</Text>
            <Text dimColor>{action.description}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>↑/↓ select · Enter run · Esc close</Text>
        </Box>
      </Box>
    </Dialog>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  const trimmed = args?.trim() ?? '';

  if (trimmed === 'start') {
    onDone(await startSkillLearning(), { display: 'system' });
    return null;
  }
  if (trimmed === 'stop') {
    onDone(await stopSkillLearning(), { display: 'system' });
    return null;
  }
  if (trimmed === 'about') {
    onDone(ABOUT_TEXT, { display: 'system' });
    return null;
  }
  if (trimmed === 'status') {
    onDone(await getStatusText(), { display: 'system' });
    return null;
  }

  if (trimmed) {
    const { call: textCall } = await import('./skill-learning.js');
    const result = await textCall(trimmed, {} as any);
    if (result && typeof result === 'object' && 'value' in result) {
      onDone((result as { value: string }).value, { display: 'system' });
    }
    return null;
  }

  return <SkillPanel onDone={onDone} />;
}
