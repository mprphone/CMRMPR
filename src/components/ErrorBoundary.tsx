import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Erro n?o capturado na interface:', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-red-100 rounded-3xl shadow-sm p-8 text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-4" size={40} />
          <h1 className="text-xl font-bold text-slate-800">Ocorreu um erro inesperado</h1>
          <p className="text-sm text-slate-500 mt-2">A aplica??o encontrou um problema nesta ?rea, mas n?o ficou presa num ecr? em branco.</p>
          {this.state.error?.message && <p className="mt-4 text-xs text-slate-400 break-words">{this.state.error.message}</p>}
          <button onClick={this.handleReload} className="mt-6 inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-black">
            <RefreshCcw size={16} /> Recarregar aplica??o
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
