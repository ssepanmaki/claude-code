/** Options of the in-session satisfaction survey (mapped to number keys 0–3). */
export type FeedbackSurveyResponse =
  | 'dismissed' // 0: dismissed, no feedback
  | 'bad' // 1: dissatisfied
  | 'fine' // 2: neutral
  | 'good' // 3: satisfied

/** Survey scenario; only session-level prompts are implemented for now. */
export type FeedbackSurveyType = 'session' // triggered from the main-session Spinner/flow
