import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { addPerson, isReferenced, removePerson, toggleSettled, type Balance } from '../../scripts/group/model';
import { statusText, toggleLabel } from '../../scripts/group/text';
import { balances, edit, group } from './store';

const t = es.group;
const TOGGLEABLE = new Set(['owes', 'owed', 'settled']);

function PersonRow({ balance }: { balance: Balance }) {
  const { person, status } = balance;
  const current = group.value!;
  return (
    <li class={`person is-${status}`}>
      <span class="person-emoji" aria-hidden="true">
        {status === 'settled' ? '✓' : person.emoji}
      </span>
      <span class="person-text">
        <strong>{person.name}</strong>
        <span>{statusText(balance, current.currency)}</span>
      </span>
      {TOGGLEABLE.has(status) && (
        <button
          type="button"
          class="pay-toggle"
          aria-pressed={status === 'settled'}
          aria-label={toggleLabel(balance)}
          title={toggleLabel(balance)}
          onClick={() => edit((draft) => toggleSettled(draft, person.id))}
        >
          ✓
        </button>
      )}
      {!isReferenced(current, person.id) && (
        <button type="button" class="person-remove" aria-label={t.removePerson(person.name)} onClick={() => edit((draft) => removePerson(draft, person.id))}>
          ×
        </button>
      )}
    </li>
  );
}

function AddPerson({ first }: { first: boolean }) {
  const [name, setName] = useState('');
  const submit = (event: Event) => {
    event.preventDefault();
    edit((draft) => addPerson(draft, name));
    setName('');
  };
  return (
    <form class="field add-row" onSubmit={submit}>
      <label class="sr-only" for="personName">
        {t.personName}
      </label>
      <input
        id="personName"
        value={name}
        maxLength={40}
        autocomplete="off"
        placeholder={first ? t.firstPersonPlaceholder : t.personPlaceholder}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <button type="submit" class="secondary small">
        {t.addPerson}
      </button>
    </form>
  );
}

export function People() {
  const count = group.value!.people.length;
  return (
    <section class="people" aria-labelledby="peopleTitle">
      <div class="section-head">
        <h3 id="peopleTitle">{t.people}</h3>
      </div>
      {count > 0 && <p class="help">{t.peopleHelp}</p>}
      <ul class="person-list">
        {balances.value.map((balance) => (
          <PersonRow key={balance.person.id} balance={balance} />
        ))}
      </ul>
      <AddPerson first={count === 0} />
    </section>
  );
}
