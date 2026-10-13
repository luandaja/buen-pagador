import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { fromPlain, type Plain } from '../../scripts/group/codec';
import { currentGroupId, loadGroup } from '../../scripts/group/groups';
import { newGroup, type Group } from '../../scripts/group/model';
import { setPageIdentity } from '../../scripts/group/page';
import { applyPalette } from '../../scripts/palettes';
import { pullRemote } from '../../scripts/group/remote';
import { PREVIEW_HASH } from '../../scripts/routes';
import { parsePublicHash, ShareError } from '../../scripts/share';
import { ExpensesCard } from './Expenses';
import { GroupHeader } from './GroupHeader';
import { PayBox } from './Pay';
import { People } from './People';
import { viewerLink } from './receipts';
import { group, preview, readOnly } from './store';
import { Totals } from './Totals';

export const VIEWER_POLL_MS = 15_000;

type Problem = 'broken' | 'gone' | 'offline' | 'empty' | null;

const problemOf = (error: unknown): Problem => (error instanceof ShareError && error.status === 404 ? 'gone' : 'offline');

function show(next: Group) {
  group.value = next;
  setPageIdentity(next.emoji, next.title);
  applyPalette(next.palette);
}

const showPlain = (plain: Plain) => show(fromPlain(plain, group.value ?? newGroup()));

async function loadLocal(): Promise<boolean> {
  const id = currentGroupId();
  const stored = id ? await loadGroup(id) : null;
  if (stored) show(stored);
  return !!stored;
}

function usePreview(): Problem {
  const [problem, setProblem] = useState<Problem>(null);
  useEffect(() => {
    readOnly.value = true;
    preview.value = true;
    const load = async () => setProblem((await loadLocal()) ? null : 'empty');
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);
  return problem;
}

function useRemote(hash: string): Problem {
  const link = parsePublicHash(hash);
  const [problem, setProblem] = useState<Problem>(link ? null : 'broken');
  useEffect(() => {
    if (!link) return;
    readOnly.value = true;
    viewerLink.value = link;
    let version = 0;
    const load = async () => {
      try {
        const pulled = await pullRemote(link, version);
        if (!('unchanged' in pulled)) showPlain(pulled.plain);
        version = pulled.v;
        setProblem(null);
      } catch (error) {
        if (!group.value) setProblem(problemOf(error));
      }
    };
    void load();
    const poll = setInterval(load, VIEWER_POLL_MS);
    return () => clearInterval(poll);
  }, []);
  return problem;
}

const v = es.viewer;
const PROBLEM_TEXT: Record<string, [string, string]> = {
  gone: [v.goneTitle, v.goneText],
  broken: [v.brokenTitle, v.brokenText],
  offline: [v.offlineTitle, v.offlineText],
  empty: [es.preview.emptyTitle, es.preview.groupEmptyText],
};

function ViewerState({ problem }: { problem: Problem }) {
  const [title, text] = PROBLEM_TEXT[problem ?? ''] ?? [v.opening, es.group.viewerOpening];
  return (
    <div class="viewer-state group-viewer-state" role="status">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function PreviewViewer() {
  return <ViewerBody problem={usePreview()} />;
}

function RemoteViewer({ hash }: { hash: string }) {
  return <ViewerBody problem={useRemote(hash)} />;
}

export function ViewerApp({ hash }: { hash: string }) {
  return hash === PREVIEW_HASH ? <PreviewViewer /> : <RemoteViewer hash={hash} />;
}

function ViewerBody({ problem }: { problem: Problem }) {
  if (problem || !group.value) return <ViewerState problem={problem} />;
  return (
    <>
      <section class="group-main">
        <ExpensesCard />
      </section>
      <aside class="panel group-panel" aria-label={group.value.title || es.group.unnamed}>
        <GroupHeader />
        <People />
        <Totals />
        <PayBox />
      </aside>
    </>
  );
}

export function mountViewerApp(root: HTMLElement) {
  root.replaceChildren();
  render(<ViewerApp hash={location.hash} />, root);
}
