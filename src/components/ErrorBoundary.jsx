import React, { Component } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
          <div className="max-w-md w-full p-8 rounded-2xl bg-card border border-border text-center shadow-xl">
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-5 border border-destructive/20">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-display font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-6">
              An unexpected issue occurred while loading this view. You can try refreshing the page or returning to the home screen.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={this.handleReload} className="gap-2">
                <RotateCcw className="w-4 h-4" /> Reload Page
              </Button>
              <Button onClick={this.handleGoHome} className="gap-2">
                <Home className="w-4 h-4" /> Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
