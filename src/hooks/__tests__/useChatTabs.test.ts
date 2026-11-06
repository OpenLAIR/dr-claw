import { describe, expect, it } from 'vitest';
import { closeChatTab, type ChatTab } from '../useChatTabs';

const tab = (id: string, isActive = false, sessionId: string | null = id): ChatTab => ({
  id,
  sessionId,
  provider: sessionId ? 'claude' : null,
  projectName: 'p',
  title: id,
  isActive,
});

describe('closeChatTab', () => {
  it('falls back to a blank chat when the last tab closes', () => {
    expect(closeChatTab([tab('a', true)], 'a')).toEqual({ tabs: [], navigateTo: { kind: 'root' } });
  });

  it('moves to the neighbour when the active tab closes', () => {
    const { tabs, navigateTo } = closeChatTab([tab('a'), tab('b', true), tab('c')], 'b');
    expect(tabs.map(t => [t.id, t.isActive])).toEqual([['a', false], ['c', true]]);
    expect(navigateTo).toEqual({ kind: 'session', sessionId: 'c', provider: 'claude', projectName: 'p' });
  });

  it('moves left when the closed active tab was the last one in the row', () => {
    const { tabs, navigateTo } = closeChatTab([tab('a'), tab('b', true)], 'b');
    expect(tabs.map(t => t.isActive)).toEqual([true]);
    expect(navigateTo).toMatchObject({ kind: 'session', sessionId: 'a' });
  });

  it('opens a blank chat when the neighbour is a new-chat tab', () => {
    expect(closeChatTab([tab('a', true), tab('new', false, null)], 'a').navigateTo).toEqual({ kind: 'root' });
  });

  it('keeps the view when an inactive tab closes', () => {
    const { tabs, navigateTo } = closeChatTab([tab('a', true), tab('b')], 'b');
    expect(tabs.map(t => t.id)).toEqual(['a']);
    expect(navigateTo).toEqual({ kind: 'none' });
  });

  it('ignores unknown tabs', () => {
    const tabs = [tab('a', true)];
    expect(closeChatTab(tabs, 'missing')).toEqual({ tabs, navigateTo: { kind: 'none' } });
  });
});
