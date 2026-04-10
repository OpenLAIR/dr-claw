import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import ChatTabBar from '../ChatTabBar';

describe('ChatTabBar', () => {
  it('renders a stable placeholder when there are no tabs', () => {
    const html = renderToStaticMarkup(
      <ChatTabBar
        tabs={[]}
        processingSessions={new Set()}
        onSwitchTab={() => {}}
        onCloseTab={() => {}}
        onNewTab={() => {}}
      />,
    );

    expect(html).toContain('aria-hidden="true"');
  });
});
