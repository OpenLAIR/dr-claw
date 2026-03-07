import React from 'react';

export default function GeminiLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      <path
        d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"
        fill="#4E8CFF"
      />
      <path
        d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"
        fill="url(#gemini-gradient-unique)"
        fillOpacity="0.8"
      />
      <defs>
        <linearGradient
          id="gemini-gradient-unique"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4E8CFF" />
          <stop offset="1" stopColor="#B576FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}
