import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { removeExpense, saveExpense, type Expense, type Person } from '../../scripts/group/model';
import type { ReadReceipt } from '../../scripts/group/read-receipt';
import {
  checkReceipt,
  draftFromExpense,
  draftFromParsed,
  expenseFromDraft,
  formatAmount,
  newDraftItem,
  removeItem,
  splitItem,
  toAmount,
  updateItem,
  type DraftItem,
  type ReceiptCheck,
  type ReceiptDraft,
} from '../../scripts/group/receipt';
import { createId } from '../../scripts/state';
import { AmongPicker, storeReceipt } from './ExpenseForm';
import { edit, group } from './store';

const t = es.group;

export type Splitting = { expense?: Expense; read?: ReadReceipt; failed?: boolean };

type ItemProps = { item: DraftItem; people: Person[]; onChange: (patch: Partial<DraftItem>) => void; onSplit: () => void; onRemove: () => void };

function ItemRow({ item, people, onChange, onSplit, onRemove }: ItemProps) {
  const name = item.what || t.receiptNewItem;
  return (
    <li class={`receipt-item${item.for.length ? '' : ' is-orphan'}`}>
      <div class="receipt-item-head">
        <input class="receipt-item-name" aria-label={t.receiptItemName} value={item.what} maxLength={60} onInput={(event) => onChange({ what: event.currentTarget.value })} />
        <input class="receipt-item-amount" aria-label={`${t.receiptItemAmount} ${name}`} inputMode="decimal" value={item.amount} onInput={(event) => onChange({ amount: event.currentTarget.value })} />
        <button type="button" class="person-remove" aria-label={t.receiptRemoveItem(name)} onClick={onRemove}>
          ×
        </button>
      </div>
      {item.quantity > 1 && (
        <button type="button" class="link" onClick={onSplit}>
          {t.receiptSplitUnits(item.quantity)}
        </button>
      )}
      <AmongPicker people={people} among={item.for} onChange={(ids) => onChange({ for: ids })} legend={t.receiptWhose(name)} />
    </li>
  );
}

function CheckLine({ check, currency }: { check: ReceiptCheck; currency: string }) {
  if (check.difference == null) return <p class="receipt-check is-warn">{t.receiptNeedsTotal}</p>;
  if (check.difference === 0) return <p class="receipt-check is-ok">{t.receiptMatches(money(check.sum, currency))}</p>;
  const amount = money(Math.abs(check.difference), currency);
  return <p class="receipt-check is-warn">{check.difference > 0 ? t.receiptMissing(amount) : t.receiptOver(amount)}</p>;
}

function Difference({ check, draft, onDraft }: { check: ReceiptCheck; draft: ReceiptDraft; onDraft: (draft: ReceiptDraft) => void }) {
  if (!check.difference || check.difference < 0) return null;
  const difference = check.difference;
  return (
    <div class="receipt-fix">
      <button type="button" class="secondary small" onClick={() => onDraft({ ...draft, items: [...draft.items, newDraftItem(t.receiptDifferenceItem, formatAmount(difference))] })}>
        {t.receiptAddDifference}
      </button>
      <button type="button" class="secondary small" onClick={() => onDraft({ ...draft, tip: formatAmount((toAmount(draft.tip) ?? 0) + difference) })}>
        {t.receiptToTip}
      </button>
    </div>
  );
}

function sourceText(splitting: Splitting): string {
  if (splitting.failed) return t.receiptReadFailed;
  if (!splitting.read) return '';
  return splitting.read.source === 'ai' ? t.receiptReadAi : t.receiptReadDevice;
}

function initialDraft(splitting: Splitting, people: Person[]): ReceiptDraft {
  if (splitting.expense) return draftFromExpense(splitting.expense);
  const parsed = splitting.read?.parsed ?? { merchant: '', items: [], tip: 0, total: null };
  return draftFromParsed(parsed, people[0].id, t.receiptDefaultWhat);
}

function Totals({ draft, onDraft }: { draft: ReceiptDraft; onDraft: (draft: ReceiptDraft) => void }) {
  return (
    <div class="field-row">
      <div class="field grow">
        <label for="receiptTip">{t.receiptTip}</label>
        <input id="receiptTip" inputMode="decimal" value={draft.tip} placeholder="0.00" onInput={(event) => onDraft({ ...draft, tip: event.currentTarget.value })} />
      </div>
      <div class="field grow">
        <label for="receiptTotal">{t.receiptTotal}</label>
        <input id="receiptTotal" inputMode="decimal" value={draft.total} placeholder="0.00" onInput={(event) => onDraft({ ...draft, total: event.currentTarget.value })} />
      </div>
    </div>
  );
}

export function ReceiptSplitter({ splitting, onDone }: { splitting: Splitting; onDone: () => void }) {
  const current = group.value!;
  const people = current.people;
  const [draft, setDraft] = useState(() => initialDraft(splitting, people));
  const check = checkReceipt(draft.items, draft.tip, draft.total);
  const setItems = (items: DraftItem[]) => setDraft({ ...draft, items });

  const save = () => {
    const id = splitting.expense?.id ?? createId();
    const expense = expenseFromDraft(draft, { id, note: splitting.expense?.note, at: splitting.expense?.at });
    edit((current) => saveExpense(current, expense));
    if (splitting.read) void storeReceipt(current.id, id, splitting.read.photo);
    onDone();
  };

  const remove = () => {
    edit((current) => removeExpense(current, splitting.expense!.id));
    void storeReceipt(current.id, splitting.expense!.id, null);
    onDone();
  };

  return (
    <section class="receipt-splitter" aria-labelledby="receiptTitle">
      <div class="section-head">
        <h3 id="receiptTitle">{t.receiptTitle}</h3>
      </div>
      {sourceText(splitting) && <p class="help">{sourceText(splitting)}</p>}
      <div class="field">
        <label for="receiptWhat">{t.what}</label>
        <input id="receiptWhat" value={draft.what} maxLength={60} onInput={(event) => setDraft({ ...draft, what: event.currentTarget.value })} />
      </div>
      <div class="field">
        <label for="receiptBy">{t.receiptPayer}</label>
        <select id="receiptBy" value={draft.by} onChange={(event) => setDraft({ ...draft, by: event.currentTarget.value })}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <p class="receipt-progress">
        {t.receiptAssigned(draft.items.length - check.orphans, draft.items.length)}
        {check.orphans > 0 && <span class="receipt-orphans"> · {t.receiptOrphans(check.orphans)}</span>}
      </p>
      <ul class="receipt-items">
        {draft.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            people={people}
            onChange={(patch) => setItems(updateItem(draft.items, item.id, patch))}
            onSplit={() => setItems(splitItem(draft.items, item.id))}
            onRemove={() => setItems(removeItem(draft.items, item.id))}
          />
        ))}
      </ul>
      <button type="button" class="secondary small" onClick={() => setItems([...draft.items, newDraftItem('')])}>
        {t.receiptAddItem}
      </button>
      <Totals draft={draft} onDraft={setDraft} />
      <p class="help">{t.receiptTipHelp}</p>
      <CheckLine check={check} currency={current.currency} />
      <Difference check={check} draft={draft} onDraft={setDraft} />
      <div class="form-actions">
        <button type="button" class="primary" disabled={!check.ready} onClick={save}>
          {t.receiptSave}
        </button>
        <button type="button" class="secondary small" onClick={onDone}>
          {t.cancel}
        </button>
        {splitting.expense && (
          <button type="button" class="link danger" onClick={remove}>
            {t.remove}
          </button>
        )}
      </div>
    </section>
  );
}
