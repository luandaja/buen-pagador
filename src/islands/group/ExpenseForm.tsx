import { useEffect, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { receiptFromFile } from '../../scripts/image';
import { createId } from '../../scripts/state';
import { beneficiaries, removeExpense, saveExpense, type Expense, type Person } from '../../scripts/group/model';
import { deleteReceipt, loadReceipt, saveReceipt } from '../../scripts/group/receipts';
import { refreshReceipts } from './receipts';
import { edit, group } from './store';

const t = es.group;

type Props = { editing?: Expense; onDone: () => void };
type Receipt = string | null | undefined;

export function parseAmount(text: string): number | null {
  const amount = Number(text.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

function toggleId(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return [...ids, id];
  return ids.length > 1 ? ids.filter((current) => current !== id) : ids;
}

export function AmongPicker({ people, among, onChange, legend = t.among }: { people: Person[]; among: string[]; onChange: (ids: string[]) => void; legend?: string }) {
  const everyone = among.length === people.length;
  return (
    <fieldset class="among">
      <legend>{legend}</legend>
      <button type="button" class="chip chip-all" aria-pressed={everyone} aria-label={t.allLabel} onClick={() => onChange(people.map((person) => person.id))}>
        {t.all}
      </button>
      {people.map((person) => (
        <button type="button" key={person.id} class="chip" aria-pressed={!everyone && among.includes(person.id)} onClick={() => onChange(everyone ? [person.id] : toggleId(among, person.id))}>
          {person.name}
        </button>
      ))}
    </fieldset>
  );
}

function initialDraft(editing: Expense | undefined, people: Person[]) {
  if (!editing) return { what: '', amount: '', by: people[0].id, among: people.map((person) => person.id), note: '' };
  return { what: editing.what, amount: String(editing.amount), by: editing.by, among: beneficiaries(editing, people), note: editing.note ?? '' };
}

export async function storeReceipt(groupId: string, expenseId: string, receipt: Receipt) {
  if (receipt === undefined) return;
  if (receipt) await saveReceipt(groupId, expenseId, receipt);
  else await deleteReceipt(groupId, expenseId);
  await refreshReceipts();
}

function EditActions({ editing, onDone }: { editing: Expense; onDone: () => void }) {
  const remove = () => {
    const groupId = group.value!.id;
    edit((draft) => removeExpense(draft, editing.id));
    void storeReceipt(groupId, editing.id, null);
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

function ReceiptField({ receipt, what, onChange }: { receipt: Receipt; what: string; onChange: (receipt: string | null) => void }) {
  const [error, setError] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange(await receiptFromFile(file));
      setError('');
    } catch {
      setError(t.receiptError);
    }
  };
  return (
    <div class="field receipt-field">
      <span class="field-label">{t.receipt}</span>
      {receipt && <img class="receipt-preview" src={receipt} alt={t.receiptAlt(what || t.expenses)} />}
      <div class="receipt-actions">
        <label class="secondary small file-btn">
          <input type="file" accept="image/*" class="sr-only" onChange={(event) => pick(event.currentTarget.files?.[0])} />
          <span>{receipt ? t.receiptChange : t.receiptAdd}</span>
        </label>
        {receipt && (
          <button type="button" class="link danger" onClick={() => onChange(null)}>
            {t.receiptRemove}
          </button>
        )}
      </div>
      <p class="help">{t.receiptHelp}</p>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type DetailsProps = { note: string; receipt: Receipt; what: string; onNote: (note: string) => void; onReceipt: (receipt: string | null) => void };

function Details({ note, receipt, what, onNote, onReceipt }: DetailsProps) {
  const filled = !!(note || receipt);
  return (
    <details class="more expense-details" open={filled}>
      <summary>{filled ? t.detailsFilled : t.details}</summary>
      <div class="more-body">
        <div class="field">
          <label for="expenseNote">{t.note}</label>
          <textarea id="expenseNote" rows={2} maxLength={200} value={note} placeholder={t.notePlaceholder} onInput={(event) => onNote(event.currentTarget.value)} />
        </div>
        <ReceiptField receipt={receipt} what={what} onChange={onReceipt} />
      </div>
    </details>
  );
}

function useReceipt(editing: Expense | undefined) {
  const [receipt, setReceipt] = useState<Receipt>(editing ? undefined : null);
  useEffect(() => {
    if (editing) void loadReceipt(group.value!.id, editing.id).then(setReceipt);
  }, [editing?.id]);
  return [receipt, setReceipt] as const;
}

export function ExpenseForm({ editing, onDone }: Props) {
  const people = group.value!.people;
  const initial = initialDraft(editing, people);
  const [what, setWhat] = useState(initial.what);
  const [amount, setAmount] = useState(initial.amount);
  const [by, setBy] = useState(initial.by);
  const [among, setAmong] = useState(initial.among);
  const [note, setNote] = useState(initial.note);
  const [receipt, setReceipt] = useReceipt(editing);
  const [error, setError] = useState('');

  const submit = (event: Event) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!what.trim() || value == null) return setError(t.invalidExpense);
    const ordered = people.map((person) => person.id).filter((id) => among.includes(id));
    const id = editing?.id ?? createId();
    edit((draft) => saveExpense(draft, { ...editing, id, what: what.trim(), amount: value, by, for: ordered, note: note.trim() || undefined }));
    void storeReceipt(group.value!.id, id, receipt);
    setWhat('');
    setAmount('');
    setAmong(people.map((person) => person.id));
    setNote('');
    setReceipt(null);
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
      <AmongPicker people={people} among={among} onChange={setAmong} />
      <Details note={note} receipt={receipt} what={what} onNote={setNote} onReceipt={setReceipt} />
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
