import type { Dispatch, ReactNode, SetStateAction } from 'react'

/** Component for each wizard step (no props, or wrapped by Wizard with injected context). */
export type WizardStepComponent = (() => ReactNode) | React.ComponentType

/** Declared props of `WizardProvider` (merged with the implementation as an intersection type). */
export type WizardProviderProps = {
  steps: WizardStepComponent[] // sequence of step components
  children?: ReactNode // optional: custom wrapper; renders the current step when omitted
  title: string // title bar text
  showStepCounter?: boolean // whether to show "step n of m"
}

/** Wizard context: current step index, accumulated data and navigation. */
export type WizardContextValue<T extends Record<string, unknown>> = {
  currentStepIndex: number // current step index
  totalSteps: number // total number of steps
  wizardData: T // aggregated data written by each step
  setWizardData: Dispatch<SetStateAction<T>> // replace the whole wizard data
  updateWizardData: (updates: Partial<T>) => void // merge a partial update
  goNext: () => void // next step; marks completion on the last step
  goBack: () => void // previous step or exit
  goToStep: (index: number) => void // non-linear jump (pushes onto the history stack)
  cancel: () => void // abandon and clear history
  title: string // title kept in sync with the Provider
  showStepCounter: boolean // whether to show the step counter
}
