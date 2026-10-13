import { useRef, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { addPerson, isReferenced, removePerson, renamePerson, rotateEmoji, toggleSettled, type Balance, type Person } from '../../scripts/group/model';
import { statusText, toggleLabel } from '../../scripts/group/text';
import { balances, edit, group, readOnly } from './store';

const t = es.group;
const TOGGLEABLE = new Set(['owes', 'owed', 'settled']);

function PersonActions({ balance }: { balance: Balance }) {
  const { person, status } = balance;
  return (
    <>
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
      {!isReferenced(group.value!, person.id) && (
        <button type="button" class="person-remove" aria-label={t.removePerson(person.name)} onClick={() => edit((draft) => removePerson(draft, person.id))}>
          ×
        </button>
      )}
    </>
  );
}

function PersonEmoji({ balance }: { balance: Balance }) {
  const { person, status } = balance;
  const shown = status === 'settled' ? '✓' : person.emoji;
  if (readOnly.value || status === 'settled') {
    return (
      <span class="person-emoji" aria-hidden="true">
        {shown}
      </span>
    );
  }
  return (
    <button type="button" class="person-emoji" aria-label={t.rotateEmoji(person.name)} title={t.rotateEmoji(person.name)} onClick={() => edit((draft) => rotateEmoji(draft, person.id))}>
      {shown}
    </button>
  );
}

function PersonName({ person }: { person: Person }) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  if (readOnly.value) return <strong>{person.name}</strong>;
  if (!editing) {
    return (
      <button
        type="button"
        class="person-name"
        aria-label={t.renamePerson(person.name)}
        title={t.renamePerson(person.name)}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        <strong>{person.name}</strong>
      </button>
    );
  }
  const commit = (name: string) => {
    if (!cancelled.current) edit((draft) => renamePerson(draft, person.id, name));
    setEditing(false);
  };
  return (
    <input
      class="person-name-input"
      aria-label={t.renamePerson(person.name)}
      defaultValue={person.name}
      maxLength={40}
      autocomplete="off"
      autoFocus
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          setEditing(false);
        }
      }}
    />
  );
}

function PersonRow({ balance }: { balance: Balance }) {
  const { person, status } = balance;
  const current = group.value!;
  return (
    <li class={`person is-${status}`}>
      <PersonEmoji balance={balance} />
      <span class="person-text">
        <PersonName person={person} />
        <span>{statusText(balance, current.currency)}</span>
      </span>
      {!readOnly.value && <PersonActions balance={balance} />}
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
      {count > 0 && !readOnly.value && <p class="help">{t.peopleHelp}</p>}
      <ul class="person-list">
        {balances.value.map((balance) => (
          <PersonRow key={balance.person.id} balance={balance} />
        ))}
      </ul>
      {!readOnly.value && <AddPerson first={count === 0} />}
    </section>
  );
}
