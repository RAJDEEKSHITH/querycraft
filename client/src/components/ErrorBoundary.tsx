import { Component, type ReactNode } from 'react'
import { ErrorMessage } from './States'

// A render error inside `children` shows the app's error state instead of unmounting
// the whole page (React has no hook for this; error boundaries must be classes).

interface ErrorBoundaryProps {
  /** What failed, for the message, e.g. "this view" or "the result table". */
  label: string
  children: ReactNode
}

export interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorMessage
        message={`Something went wrong while showing ${this.props.label}.`}
        onRetry={() => {
          this.setState({ failed: false })
        }}
      />
    )
  }
}
