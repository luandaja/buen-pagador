import { es } from '../../i18n/es';
import { computeGroupTotals, type Group } from '../../scripts/group/model';
import { money } from '../../scripts/state';
import { createGroup, group, openGroup, removeGroup, savedGroups } from './store';

const t = es.group;

function GroupRow({ saved, isCurrent }: { saved: Group; isCurrent: boolean }) {
  const title = saved.title.trim() || t.unnamed;
  const sum = computeGroupTotals(saved);
  const confirmRemove = () => {
    if (confirm(t.removeConfirm(title))) void removeGroup(saved.id);
  };
  return (
    <li class="saved-group">
      <button type="button" class="saved-open" aria-current={isCurrent} aria-label={t.open(title)} onClick={() => openGroup(saved.id)}>
        <span class="saved-emoji" aria-hidden="true">
          {saved.emoji}
        </span>
        <strong>{title}</strong>
        <span class="saved-amount">{money(sum.pending, saved.currency)}</span>
      </button>
      <button type="button" class="link danger" onClick={confirmRemove}>
        {t.removeGroup}
      </button>
    </li>
  );
}

export function GroupList() {
  const currentId = group.value!.id;
  return (
    <details class="more group-list">
      <summary>
        {t.list} ({savedGroups.value.length})
      </summary>
      <div class="more-body">
        <button type="button" class="secondary small" onClick={() => createGroup()}>
          {t.newGroup}
        </button>
        <ul class="saved-groups">
          {savedGroups.value.map((saved) => (
            <GroupRow key={saved.id} saved={saved} isCurrent={saved.id === currentId} />
          ))}
        </ul>
      </div>
    </details>
  );
}
