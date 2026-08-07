// Compact progress bar used across ResearchFlow views.

import React from 'react';

export default function Progress({ value, className = '' }) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`h-1.5 w-full rounded-full bg-muted overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
