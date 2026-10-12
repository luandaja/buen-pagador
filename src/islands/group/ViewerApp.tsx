import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { fromPlain, type Plain } from '../../scripts/group/codec';
import { newGroup } from '../../scripts/group/model';
import { setPageIdentity } from '../../scripts/group/page';
import { pullRemote } from '../../scripts/group/remote';
import { parsePublicHash, ShareError } from '../../scripts/share';
import { ExpensesCard } from './Expenses';
import { GroupHeader } from './GroupHeader';
import { People } from './People';
import { group, readOnly } from './store';
import { Totals } from './Totals';

export const VIEWER_POLL_MS = 15_000;

type Problem = 'broken' | 'gone' | 'offline' | null;

const problemOf = (error: unknown): Problem => (error instanceof ShareError && error.status === 404 ? 'gone' : 'offline');

function showPlain(plain: Plain) {
  group.value = fromPlain(plain, group.value ?? newGroup());
  setPageIdentity(group.value.emoji, group.value.title);
}

function ViewerState({ problem }: { problem: Problem }) {
  const v = es.viewer;
  const [title, text] =
    problem === 'gone' ? [v.goneTitle, v.goneText] : problem === 'broken' ? [v.brokenTitle, v.brokenText] : problem === 'offline' ? [v.offlineTitle, v.offlineText] : [v.opening, es.group.viewerOpening];
  return (
    <div class="viewer-state group-viewer-state" role="status">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function ViewerApp({ hash }: { hash: string }) {
  const link = parsePublicHash(hash);
  const [problem, setProblem] = useState<Problem>(link ? null : 'broken');

  useEffect(() => {
    if (!link) return;
    readOnly.value = true;
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
      </aside>
    </>
  );
}

export function mountViewerApp(root: HTMLElement) {
  root.replaceChildren();
  render(<ViewerApp hash={location.hash} />, root);
}
