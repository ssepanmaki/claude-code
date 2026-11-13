// research-report.workflow.mjs
// Technical research report workflow.
// Executed directly by run.ts through runWorkflow() of @claude-code-best/workflow-engine —
// without the Workflow tool or the core runAgent. agent / parallel / pipeline /
// phase / log / args inside the script are globals injected by the engine runtime (see the sandbox in src/engine/script.ts).
//
// Orchestration: parallel multi-angle research (parallel barrier) → per-finding deep dive (pipeline, no barrier) → synthesize into a report.

export const meta = {
  name: 'research-report',
  description:
    'Multi-angle tech research → deep-read → synthesize into a Markdown report',
  whenToUse: 'Research a technical topic: investigate from several angles in parallel, dive into each finding, and synthesize a structured report',
  phases: [
    { title: 'Research', detail: 'Parallel multi-angle research (parallel barrier)' },
    { title: 'DeepRead', detail: 'Per-finding deep dive (pipeline, no barrier)' },
    { title: 'Synthesize', detail: 'Synthesize into a Markdown report' },
  ],
}

// agent(schema) makes the sub-agent return a "validated object" instead of plain text.
const ANGLE_SCHEMA = {
  type: 'object',
  required: ['angle', 'findings'],
  properties: {
    angle: { type: 'string', description: 'Name of the angle for this research' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'One-sentence conclusion' },
          evidence: { type: 'string', description: 'Basis / source / rationale' },
        },
      },
    },
  },
}

const DEEP_SCHEMA = {
  type: 'object',
  required: ['claim', 'analysis', 'confidence'],
  properties: {
    claim: { type: 'string' },
    analysis: { type: 'string', description: 'Mechanism / preconditions / boundaries / counterexamples' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}

// ---- Input (passed through by run.ts via args) ----
const topic = args.topic
if (typeof topic !== 'string' || topic.length === 0) {
  throw new Error('research-report requires args.topic (the research topic string)')
}
const angles =
  Array.isArray(args.angles) && args.angles.length > 0
    ? args.angles
    : ['Core concepts and principles', 'Mainstream approaches and comparison', 'Engineering practice and trade-offs', 'Ecosystem and trends']

// ---- Phase 1: parallel multi-angle research. parallel = barrier; continue only after all angles finish. ----
phase('Research')
log(`Topic "${topic}": researching ${angles.length} angles in parallel`)
const researched = await parallel(
  angles.map(
    a => () =>
      agent(
        `You are a senior technical research analyst. For the technical topic "${topic}", investigate from the angle "${a}" and give the 2-4 most important technical findings under that angle, each with supporting evidence.`,
        { label: `research:${a}`, phase: 'Research', schema: ANGLE_SCHEMA },
      ),
  ),
)
// parallel returns (object|null)[]: skipped/dead angles are null; filter and flatten
const allFindings = researched
  .filter(Boolean)
  .flatMap(r => r.findings.map(f => ({ ...f, angle: r.angle })))
log(`Collected ${allFindings.length} findings, moving on to the deep dive`)

if (allFindings.length === 0) {
  return {
    topic,
    report: '(All angles failed; no findings available)',
    anglesCovered: 0,
    findingsDeepened: 0,
  }
}

// ---- Phase 2: per-finding deep dive. pipeline = no barrier; each finding runs through all stages independently without waiting on others. ----
phase('DeepRead')
const deepened = await pipeline(
  allFindings,
  f =>
    agent(
      `Analyze the following technical finding in depth: its mechanism, preconditions, boundaries of applicability and possible counterexamples:\nConclusion: ${f.claim}\nEvidence: ${f.evidence}\nAngle: ${f.angle}`,
      { label: `deep:${f.angle}`, phase: 'DeepRead', schema: DEEP_SCHEMA },
    ),
  // Second stage: annotate cross-cutting value by confidence (demonstrates chained passing in a multi-stage pipeline).
  // If stage-1 died and returned null, guard explicitly here — avoid reading properties of null (otherwise the pipeline's
  // per-item catch swallows it and the whole item is silently lost).
  d =>
    d
      ? {
          ...d,
          crossCutting:
            d.confidence === 'high' ? 'Can serve as the backbone of the report' : 'Cite with caution or corroborate',
        }
      : null,
)
const deepFindings = deepened.filter(Boolean)
log(`Deep dive finished: ${deepFindings.length}/${allFindings.length} findings`)

// ---- Phase 3: synthesize into a Markdown report (no schema → returns plain text) ----
phase('Synthesize')
const report = await agent(
  `You are the chief technical analyst. Based on the following deep-dived technical findings, synthesize a structured research report (pure Markdown prose).\nRequirements: include an abstract, per-angle analysis, key conclusions, recommendations and risks; state each finding in natural language and note its confidence.\nForbidden: pasting JSON code blocks into the report or quoting the input data below verbatim.\n\nTopic: ${topic}\n\nDeep findings (JSON, for your understanding only; do not output verbatim):\n${JSON.stringify(deepFindings)}`,
  { label: 'synthesize', phase: 'Synthesize', maxTokens: 8192 },
)

return {
  topic,
  report,
  anglesCovered: angles.length,
  findingsDeepened: deepFindings.length,
}
