import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMsg = error.message || 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(displayMsg) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        displayMsg = `Database ${parsed.operationType || 'operation'} failed on ${parsed.path || 'record'}: ${parsed.error}`;
      }
    } catch {
      // Non-JSON error message
    }
    return { hasError: true, message: displayMsg };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#09090B] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#11131A] border border-red-500/30 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold text-white">Application Error</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
