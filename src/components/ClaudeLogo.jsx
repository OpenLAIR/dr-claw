import React from 'react';
import RetryingImage from './RetryingImage';

const ClaudeLogo = ({className = 'w-5 h-5'}) => {
  return (
    <RetryingImage
      src="/icons/claude-ai-icon.svg"
      alt="Claude"
      className={className}
      loading="eager"
      decoding="sync"
      fetchpriority="high"
    />
  );
};

export default ClaudeLogo;
