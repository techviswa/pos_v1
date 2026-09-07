import React from "react";
import { ApiErrorPanel } from "./ApiErrorPanel";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    // Keep the UI stable while preserving diagnostics in the browser console.
    console.error("UI render error", error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.reset();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="cf-app-error">
          <ApiErrorPanel
            action="The POS is still running. Retry this screen, or go back if this keeps happening."
            message="Something on this screen failed to load. Please try again."
            onBack={() => window.history.back()}
            onRetry={this.reset}
            title="Screen failed to render"
          />
        </div>
      );
    }

    return this.props.children;
  }
}
