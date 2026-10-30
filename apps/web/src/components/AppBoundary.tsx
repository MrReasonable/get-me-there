import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COPY } from '../copy.js';

/** Top-level boundary: a render error shows a message instead of a blank page (review tsr-002). */
export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[page failed]', error.message, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <p role="alert" className="plate notice m-4 font-semibold text-bad">
        {COPY.appFailed}
      </p>
    ) : (
      this.props.children
    );
  }
}
