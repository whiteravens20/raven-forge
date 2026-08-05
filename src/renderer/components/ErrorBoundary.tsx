import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@renderer/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Renderer error:', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-rf-bg p-6 text-rf-text">
          <div className="max-w-md space-y-4 rounded-lg border border-rf-border bg-rf-surface p-6 text-center">
            <h1 className="text-xl font-display font-bold text-rf-danger">{t('error.title')}</h1>
            {/* A class component cannot use hooks, and this one renders while
                the React tree is already broken — the non-reactive `t()` is
                exactly the right tool here. */}
            <p className="text-sm text-rf-text-secondary">{t('error.body')}</p>
            {this.state.error && (
              <pre className="max-h-40 overflow-auto rounded border border-rf-border bg-rf-bg p-2 text-left text-xs text-rf-text-muted">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-rf-accent px-4 py-2 text-sm font-medium text-white hover:bg-rf-accent-hover transition-colors"
            >
              {t('error.restart')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
