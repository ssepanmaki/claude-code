const MODEL_EMAIL_MAP: Array<{ keywords: string[]; email: string }> = [
  { keywords: ['claude'], email: 'noreply@anthropic.com' },
  // Because their email and avatar could not be found, our own email is used for recording for now; it can be replaced once the vendor has a GitHub-usable email
  // GitHub organizations cannot be used as co-authors
  {
    keywords: ['gpt', 'dall-e', 'o1-', 'o3-', 'o4-'],
    email: 'openai@claude-code-best.win',
  },
  { keywords: ['gemini'], email: 'google-gemini@claude-code-best.win' },
  { keywords: ['grok'], email: 'xai-org@claude-code-best.win' },
  { keywords: ['glm'], email: 'zai-org@claude-code-best.win' },
  { keywords: ['deepseek'], email: 'deepseek-ai@claude-code-best.win' },
  { keywords: ['qwen'], email: 'QwenLM@claude-code-best.win' },
  { keywords: ['minimax'], email: 'MiniMax-AI@claude-code-best.win' },
  { keywords: ['mimo'], email: 'XiaomiMiMo@claude-code-best.win' },
  { keywords: ['kimi'], email: 'MoonshotAI@claude-code-best.win' },
]

export function getAttributionEmail(modelName: string): string {
  const lower = modelName.toLowerCase()
  for (const { keywords, email } of MODEL_EMAIL_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      return email
    }
  }
  return 'noreply@anthropic.com'
}
