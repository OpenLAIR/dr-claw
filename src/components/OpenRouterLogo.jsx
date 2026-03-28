import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const OpenRouterLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke={isDarkMode ? '#a78bfa' : '#7c3aed'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default OpenRouterLogo;
