import React from 'react';
import RetryingImage from './RetryingImage';
import { useTheme } from '../contexts/ThemeContext';

const CursorLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <RetryingImage
      src={isDarkMode ? "/icons/cursor-white.svg" : "/icons/cursor.svg"}
      alt="Cursor"
      className={className}
    />
  );
};

export default CursorLogo;
