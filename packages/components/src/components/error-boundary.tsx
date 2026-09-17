import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isConvexUnauthenticatedError } from '@molly/shared';
import { ErrorBoundaryFallback } from '@/components/error-boundary-fallback';

export type ErrorBoundaryFallbackProps = {
  error: Error;
  resetErrorBoundary: () => void;
  componentStack?: string | null;
};

type ErrorBoundaryVariant = 'page' | 'section' | 'inline';

export type ErrorBoundaryProps = {
  children: ReactNode;
  name?: string;
  variant?: ErrorBoundaryVariant;
  /** Source compatibility only; changed keys never retry a crashed subtree. */
  resetKeys?: ReadonlyArray<unknown>;
  onReset?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
  fallback?: ReactNode;
  fallbackRender?: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /**
   * Show the error text and technical details in the default fallback.
   * Defaults to `true` on every build: a crash the user cannot read or copy is a
   * crash we never hear about.
   */
  showErrorDetails?: boolean;
  propagateAuthErrors?: boolean;
};

type ErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
  };

  static getDerivedStateFromError(
    error: Error
  ): Pick<ErrorBoundaryState, 'error' | 'componentStack'> {
    return { error, componentStack: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.propagateAuthErrors !== false && isConvexUnauthenticatedError(error)) {
      return;
    }

    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
  }

  /** Only explicit user recovery clears a captured error. */
  resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState({
      error: null,
      componentStack: null,
    });
  };

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.propagateAuthErrors !== false && isConvexUnauthenticatedError(error)) {
      throw error;
    }

    const fallbackProps: ErrorBoundaryFallbackProps = {
      error,
      resetErrorBoundary: this.resetErrorBoundary,
      componentStack: this.state.componentStack,
    };

    if (this.props.fallbackRender) {
      return this.props.fallbackRender(fallbackProps);
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <ErrorBoundaryFallback
        {...fallbackProps}
        variant={this.props.variant ?? 'section'}
        componentStack={this.state.componentStack}
        boundaryName={this.props.name}
        // Details are shown in production too: without them a wedged user has
        // nothing to report and we have nothing to debug.
        showErrorDetails={this.props.showErrorDetails ?? true}
      />
    );
  }
}
