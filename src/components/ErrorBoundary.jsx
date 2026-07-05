import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[PixelKit render failed]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal" role="alert">
          <b>PixelKit hit a render error</b>
          <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          <button type="button" className="ghost" onClick={() => location.reload()}>Reload app</button>
        </div>
      );
    }
    return this.props.children;
  }
}
