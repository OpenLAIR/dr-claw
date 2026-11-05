import React from 'react';
import RetryingImage from './RetryingImage';
import { useTheme } from '../contexts/ThemeContext';

const CodexLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <RetryingImage
      src={isDarkMode ? "/icons/codex-white.svg" : "/icons/codex.svg"}
      alt="Codex"
      className={className}
      loading="eager"
      decoding="sync"
      fetchpriority="high"
    />
  );
};

export default CodexLogo;
