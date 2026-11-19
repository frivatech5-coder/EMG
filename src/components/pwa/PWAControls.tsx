import { useState } from 'react';
import { Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useOnlineStatus, usePWAInstall } from '../../hooks/usePWA';

export function PWAInstallButton() {
  const { canPromptInstall, showIOSInstallGuide, isInstalled, promptInstall } = usePWAInstall();
  const [iosGuideOpen, setIosGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (isInstalled || (!canPromptInstall && !showIOSInstallGuide)) {
    return null;
  }

  const handleInstallClick = async () => {
    if (canPromptInstall) {
      setInstalling(true);
      try {
        await promptInstall();
      } finally {
        setInstalling(false);
      }
      return;
    }
    if (showIOSInstallGuide) {
      setIosGuideOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstallClick()}
        disabled={installing}
        title="Install EMG Web Solutions App"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-300 hover:text-white bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden md:inline">{installing ? 'Installing...' : 'Install App'}</span>
      </button>

      {iosGuideOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
        >
          <div className="w-full max-w-sm bg-[#11131A] border border-white/10 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="ios-install-title" className="text-sm font-semibold text-white">
                  Install EMG App on iPhone / iPad
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Add EMG Web Solutions to your Home Screen for full-screen standalone access.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIosGuideOpen(false)}
                aria-label="Close instructions"
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-2.5 text-xs text-slate-300 list-decimal list-inside">
              <li>
                Tap the <span className="inline-flex items-center gap-1 font-semibold text-white"><Share className="w-3.5 h-3.5 text-blue-400" /> Share</span> button in Safari&apos;s toolbar.
              </li>
              <li>
                Scroll down and select <span className="font-semibold text-white">Add to Home Screen</span>.
              </li>
              <li>
                Confirm by tapping <span className="font-semibold text-white">Add</span> in the top right.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setIosGuideOpen(false)}
              className="w-full py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>
        You are currently offline. Changes and live Cloud Firestore queries require an internet connection.
      </span>
    </div>
  );
}

export function PWAUpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('SW registration warning:', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-4 left-4 z-50 max-w-sm bg-[#11131A] border border-blue-500/35 rounded-xl p-3.5 shadow-2xl flex items-center gap-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">Dashboard update ready</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Reload when ready to apply the latest application shell.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Reload
        </button>
      </div>
    </div>
  );
}
