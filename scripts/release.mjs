// Bumps the version once per conventional commit that reached main since the last tag:
// `type!:` or a `BREAKING CHANGE` footer → major, feat/fix → minor, anything else → patch.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'https://github.com/luandaja/buen-pagador';
const HEADER = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/;
const RELEASE = /^chore\(release\):/;
const SECTIONS = ['⚠ BREAKING CHANGES', 'Features', 'Bug Fixes', 'Other Changes'];

export function bumpOf({ subject, body = '' }) {
  const [, type, bang] = subject.match(HEADER) ?? [];
  if (bang || /^BREAKING[ -]CHANGE:/m.test(body)) return 'major';
  return type === 'feat' || type === 'fix' ? 'minor' : 'patch';
}

export function bump(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Commits go oldest first, so a PR with a feat and a fix moves 1.5.0 → 1.6.0 → 1.6.1.
export function nextVersion(version, commits) {
  return commits.reduce((current, commit) => bump(current, bumpOf(commit)), version);
}

function sectionOf(commit) {
  if (bumpOf(commit) === 'major') return SECTIONS[0];
  const type = commit.subject.match(HEADER)?.[1];
  return type === 'feat' ? SECTIONS[1] : type === 'fix' ? SECTIONS[2] : SECTIONS[3];
}

export function changelogEntry(previous, next, commits, date) {
  const lines = [`## [${next}](${REPO}/compare/v${previous}...v${next}) (${date})`];
  for (const title of SECTIONS) {
    const items = commits.filter((commit) => sectionOf(commit) === title);
    if (!items.length) continue;
    lines.push('', `### ${title}`, '');
    for (const { sha, subject } of items) {
      const text = subject.match(HEADER)?.[3] ?? subject;
      lines.push(`* ${text} ([${sha.slice(0, 7)}](${REPO}/commit/${sha}))`);
    }
  }
  return lines.join('\n');
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function commitsSince(tag) {
  const log = git('log', `${tag}..HEAD`, '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%b%x1e');
  return log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body] = record.split('\x1f');
      return { sha, subject, body };
    })
    .filter(({ subject }) => !RELEASE.test(subject));
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const commits = commitsSince(`v${pkg.version}`);
  if (!commits.length) return;

  const next = nextVersion(pkg.version, commits);
  const entry = changelogEntry(pkg.version, next, commits, new Date().toISOString().slice(0, 10));
  const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/^# Changelog\n+/, '');
  writeFileSync('CHANGELOG.md', `# Changelog\n\n${entry}\n\n${changelog}`);
  writeFileSync('package.json', JSON.stringify({ ...pkg, version: next }, null, 2) + '\n');
  writeFileSync('release-notes.md', entry.split('\n').slice(1).join('\n').trim() + '\n');
  console.log(next);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
