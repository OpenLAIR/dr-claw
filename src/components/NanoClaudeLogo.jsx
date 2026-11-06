import React from 'react';
import RetryingImage from './RetryingImage';

const NanoClaudeLogo = ({ className = 'w-5 h-5' }) => {
  return (
    <RetryingImage
      src="/icons/nanoclaude.png"
      alt="Nano Claude Code"
      className={`${className} rounded-[22%] object-cover`}
      loading="eager"
      decoding="sync"
    />
  );
};

export default NanoClaudeLogo;
