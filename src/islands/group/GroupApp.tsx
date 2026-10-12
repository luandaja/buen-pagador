import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { es } from '../../i18n/es';
import { setPageIdentity } from '../../scripts/group/page';
import { ExpensesCard } from './Expenses';
import { GroupHeader } from './GroupHeader';
import { GroupList } from './GroupList';
import { People } from './People';
import { ShareBox } from './ShareBox';
import { flush, group, start } from './store';
import { joinFromHash, syncNow, syncWhenVisible } from './sync';
import { Totals } from './Totals';

function onVisibility() {
  if (document.visibilityState === 'hidden') void flush();
  else syncWhenVisible();
}

async function boot() {
  const { hash } = location;
  if (hash) history.replaceState(null, '', location.pathname);
  await start();
  await joinFromHash(hash);
}

export function GroupApp() {
  useEffect(() => {
    void boot();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const current = group.value;
  useEffect(() => {
    if (current) setPageIdentity(current.emoji, current.title);
  }, [current?.emoji, current?.title]);

  useEffect(() => {
    void syncNow();
  }, [current?.id]);

  if (!current) return <p class="group-loading">{es.group.loading}</p>;
  return (
    <>
      <section class="group-main">
        <ExpensesCard />
      </section>
      <aside class="panel group-panel" aria-label={current.title || es.group.unnamed}>
        <GroupHeader />
        <People />
        <Totals />
        <ShareBox />
        <GroupList />
      </aside>
    </>
  );
}

export function mountGroupApp(root: HTMLElement) {
  root.replaceChildren();
  render(<GroupApp />, root);
}
