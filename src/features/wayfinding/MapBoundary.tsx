import { Component, type ReactNode } from 'react';

export class MapBoundary extends Component<{ children: ReactNode; failureText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p className="wf-notice" role="status">{this.props.failureText}</p> : this.props.children;
  }
}
