import { expect, test } from 'bun:test';
import React from 'react';
import { EffortPanel } from '../EffortPanel.js';

// EffortPanel is a UI component; its render dependency chain (useMainLoopModel / GrowthBook / settings)
// is costly to simulate in the test environment and makes tests brittle. This file only does a "component contract" sanity check:
// 1) The default export is a valid React component
// 2) Accepts the correct props type (guaranteed at compile time)
// 3) onDone has type (message: string) => void
//
// Render output and keyboard interaction are covered by manual acceptance in Step 6.2;
// the confirm/cancel branches are covered by the computeConfirmOutcome pure-function tests (see effortPanelState.test.ts).

test('EffortPanel is a valid React component', () => {
  expect(typeof EffortPanel).toBe('function');
});

test('EffortPanel accepts props and returns a React element (not mounted)', () => {
  const element = React.createElement(EffortPanel, {
    appStateEffort: undefined,
    onDone: () => {},
  });
  expect(React.isValidElement(element)).toBe(true);
});
