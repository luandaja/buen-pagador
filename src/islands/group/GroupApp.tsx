import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { es } from '../../i18n/es';
import { setPageIdentity } from '../../scripts/group/page';
import { ExpensesCard } from './Expenses';
import { GroupHeader } from './GroupHeader';
import { GroupList } from './GroupList';
import { People } from './People';
import { flush, group, start } from './store';
import { Totals } from './Totals';

function saveWhenHidden() {
  if (document.visibilityState === 'hidden') void flush();
}

export function GroupApp() {
  useEffect(() => {
    void start();
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => document.removeEventListener('visibilitychange', saveWhenHidden);
  }, []);

  const current = group.value;
  useEffect(() => {
    if (current) setPageIdentity(current.emoji, current.title);
  }, [current?.emoji, current?.title]);

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
        <GroupList />
      </aside>
    </>
  );
}

export function mountGroupApp(root: HTMLElement) {
  root.replaceChildren();
  render(<GroupApp />, root);
}
