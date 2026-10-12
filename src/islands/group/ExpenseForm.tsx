import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { createId } from '../../scripts/state';
import { beneficiaries, removeExpense, saveExpense, type Expense, type Person } from '../../scripts/group/model';
import { edit, group } from './store';

const t = es.group;

type Props = { editing?: Expense; onDone: () => void };

export function parseAmount(text: string): number | null {
  const amount = Number(text.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

function toggleId(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return [...ids, id];
  return ids.length > 1 ? ids.filter((current) => current !== id) : ids;
}

function initialDraft(editing: Expense | undefined, people: Person[]) {
  if (!editing) return { what: '', amount: '', by: people[0].id, among: people.map((person) => person.id) };
  return { what: editing.what, amount: String(editing.amount), by: editing.by, among: beneficiaries(editing, people) };
}

function EditActions({ editing, onDone }: { editing: Expense; onDone: () => void }) {
  const remove = () => {
    edit((draft) => removeExpense(draft, editing.id));
    onDone();
  };
  return (
    <>
      <button type="button" class="secondary small" onClick={onDone}>
        {t.cancel}
      </button>
      <button type="button" class="link danger" onClick={remove}>
        {t.remove}
      </button>
    </>
  );
}

export function ExpenseForm({ editing, onDone }: Props) {
  const people = group.value!.people;
  const initial = initialDraft(editing, people);
  const [what, setWhat] = useState(initial.what);
  const [amount, setAmount] = useState(initial.amount);
  const [by, setBy] = useState(initial.by);
  const [among, setAmong] = useState(initial.among);
  const [error, setError] = useState('');

  const submit = (event: Event) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!what.trim() || value == null) return setError(t.invalidExpense);
    const ordered = people.map((person) => person.id).filter((id) => among.includes(id));
    edit((draft) => saveExpense(draft, { ...editing, id: editing?.id ?? createId(), what: what.trim(), amount: value, by, for: ordered }));
    setWhat('');
    setAmount('');
    setAmong(people.map((person) => person.id));
    setError('');
    onDone();
  };

  return (
    <form class="expense-form" onSubmit={submit} noValidate>
      <div class="field-row">
        <div class="field grow">
          <label for="expenseWhat">{t.what}</label>
          <input id="expenseWhat" value={what} maxLength={60} autocomplete="off" placeholder={t.whatPlaceholder} onInput={(event) => setWhat(event.currentTarget.value)} />
        </div>
        <div class="field amount-field">
          <label for="expenseAmount">{t.amount}</label>
          <input id="expenseAmount" value={amount} inputMode="decimal" placeholder="0" autocomplete="off" onInput={(event) => setAmount(event.currentTarget.value)} />
        </div>
      </div>
      <div class="field">
        <label for="expenseBy">{t.by}</label>
        <select id="expenseBy" value={by} onChange={(event) => setBy(event.currentTarget.value)}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset class="among">
        <legend>{t.among}</legend>
        {people.map((person) => (
          <button type="button" key={person.id} class="chip" aria-pressed={among.includes(person.id)} onClick={() => setAmong(toggleId(among, person.id))}>
            {person.name}
          </button>
        ))}
      </fieldset>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        <button type="submit" class="primary">
          {editing ? t.save : t.add}
        </button>
        {editing && <EditActions editing={editing} onDone={onDone} />}
      </div>
    </form>
  );
}
