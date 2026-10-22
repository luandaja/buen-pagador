import { describe, expect, it } from 'vitest';
import { bumpOf, changelogEntry, nextVersion } from '../scripts/release.mjs';

const commit = (subject: string, body = '') => ({ sha: 'abcdef1234567890', subject, body });

describe('release', () => {
  it('maps breaking changes to major, feat and fix to minor, the rest to patch', () => {
    expect(bumpOf(commit('feat!: drop old links'))).toBe('major');
    expect(bumpOf(commit('refactor(store): new keys', 'BREAKING CHANGE: old groups are gone'))).toBe('major');
    expect(bumpOf(commit('feat: court games'))).toBe('minor');
    expect(bumpOf(commit('fix(group): single scrollbar'))).toBe('minor');
    expect(bumpOf(commit('ci: faster e2e'))).toBe('patch');
    expect(bumpOf(commit('Update README'))).toBe('patch');
  });

  it('bumps once per commit, oldest first', () => {
    expect(nextVersion('1.5.0', [commit('feat: a'), commit('fix: b'), commit('docs: c')])).toBe('1.7.1');
    expect(nextVersion('1.7.1', [commit('style: x'), commit('feat!: y')])).toBe('2.0.0');
    expect(nextVersion('1.5.0', [])).toBe('1.5.0');
  });

  it('groups the changelog by kind of change', () => {
    const entry = changelogEntry('1.5.0', '1.6.1', [commit('feat(cuentas): emoji'), commit('ci: cache')], '2026-10-22');
    expect(entry).toContain('## [1.6.1](https://github.com/luandaja/buen-pagador/compare/v1.5.0...v1.6.1) (2026-10-22)');
    expect(entry).toContain('### Features\n\n* emoji ([abcdef1]');
    expect(entry).toContain('### Other Changes\n\n* cache');
    expect(entry).not.toContain('Bug Fixes');
  });
});
