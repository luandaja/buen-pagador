import { describe, expect, it } from 'vitest';
import { followPage, stickyTop } from '../../src/scripts/group/sticky-panel';

describe('stickyTop', () => {
  it('pins a short panel to the top', () => {
    expect(stickyTop(400, 800)).toBe(16);
  });

  it('pins a tall panel by its bottom edge', () => {
    expect(stickyTop(1200, 800)).toBe(-416);
  });
});

describe('followPage', () => {
  it('sets the offset and stops listening on cleanup', () => {
    const panel = document.createElement('aside');
    Object.defineProperty(panel, 'offsetHeight', { value: 2000 });
    const stop = followPage(panel);
    expect(panel.style.getPropertyValue('--panel-top')).toBe(`${innerHeight - 2000 - 16}px`);
    stop();
  });
});
