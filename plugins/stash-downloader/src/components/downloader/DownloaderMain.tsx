/**
 * DownloaderMain - Main component for the downloader plugin
 */

import React, { useEffect } from 'react';
import { ToastProvider } from '@/contexts/ToastContext';
import { LogProvider } from '@/contexts/LogContext';
import { useLoggerBridge } from '@/hooks';
import { ToastContainer } from '@/components/common';
import { QueuePage } from './QueuePage';
import { observeHostTheme } from '@/utils/theme';

/** Inner component that sets up the logger bridge (must be inside LogProvider) */
const DownloaderContent: React.FC = () => {
  // Connect global Logger to LogContext
  useLoggerBridge();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.stash-downloader-plugin');
    return root ? observeHostTheme(root) : undefined;
  }, []);

  return (
    <div className="stash-downloader-plugin" style={{ minHeight: '100vh' }}>
      <ToastContainer />
      <QueuePage />
    </div>
  );
};

export const DownloaderMain: React.FC = () => {
  return (
    <ToastProvider>
      <LogProvider>
        <DownloaderContent />
      </LogProvider>
    </ToastProvider>
  );
};
