import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COPY } from '../copy.js';

interface State {
  failed: boolean;
}

/** Catches a price that failed provenance validation and shows the withheld message instead. Spec §9 item 6. */
export class PriceBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // why: a withheld price is a contract bug; make it loud in the console without breaking the page.
    console.error('[price withheld]', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <span role="alert" className="text-sm bad-text">
          {COPY.priceWithheld}
        </span>
      );
    }
    return this.props.children;
  }
}
