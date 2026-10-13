import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { amongText, payerName } from '../../scripts/group/text';
import { prefersLocalOcr, readReceipt, setPrefersLocalOcr } from '../../scripts/group/read-receipt';
import { ExpenseDetail } from './ExpenseDetail';
import { ExpenseForm } from './ExpenseForm';
import { ReceiptSplitter, type Splitting } from './ReceiptSplitter';
import type { Expense, Person } from '../../scripts/group/model';
import { receiptSet } from './receipts';
import { group, readOnly, totals } from './store';

const t = es.group;

function ExpenseContent({ expense, people, currency }: { expense: Expense; people: Person[]; currency: string }) {
  return (
    <>
      <span class="expense-text">
        <strong>
          {expense.what}
          {receiptSet.value.has(expense.id) && (
            <span class="receipt-mark" role="img" aria-label={t.hasReceipt} title={t.hasReceipt}>
              📎
            </span>
          )}
        </strong>
        <span>
          {t.paidBy(payerName(expense, people))} · {amongText(expense, people)}
        </span>
        {expense.note && <span class="expense-note">{expense.note}</span>}
      </span>
      <span class="expense-amount">{money(expense.amount, currency)}</span>
    </>
  );
}

function ExpenseList({ editingId, onEdit }: { editingId: string | null; onEdit: (id: string) => void }) {
  const current = group.value!;
  if (current.expenses.length === 0) return current.people.length ? <p class="help">{t.noExpenses}</p> : null;
  return (
    <ul class="expense-list">
      {[...current.expenses].reverse().map((expense) => (
        <li key={expense.id}>
          {readOnly.value ? (
            <>
              <button
                type="button"
                class="expense-row"
                aria-expanded={expense.id === editingId}
                aria-controls={`detail-${expense.id}`}
                aria-label={t.viewDetail(expense.what)}
                onClick={() => onEdit(expense.id)}
              >
                <ExpenseContent expense={expense} people={current.people} currency={current.currency} />
              </button>
              {expense.id === editingId && <ExpenseDetail expense={expense} />}
            </>
          ) : (
            <button type="button" class="expense-row" aria-current={expense.id === editingId} aria-label={t.edit(expense.what)} onClick={() => onEdit(expense.id)}>
              <ExpenseContent expense={expense} people={current.people} currency={current.currency} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ExpenseEditor({ editing, onDone }: { editing?: Expense; onDone: () => void }) {
  const current = group.value!;
  if (readOnly.value) return null;
  if (!current.people.length) return <p class="help">{t.needPeople}</p>;
  return <ExpenseForm key={editing?.id ?? `new-${current.people.length}`} editing={editing} onDone={onDone} />;
}

function ReceiptButton({ onRead }: { onRead: (splitting: Splitting) => void }) {
  const [reading, setReading] = useState(false);
  const [localOnly, setLocalOnly] = useState(prefersLocalOcr);
  const toggleLocal = (value: boolean) => {
    setLocalOnly(value);
    setPrefersLocalOcr(value);
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      onRead({ read: await readReceipt(file, localOnly) });
    } catch {
      onRead({ failed: true });
    } finally {
      setReading(false);
    }
  };
  if (readOnly.value || !group.value!.people.length) return null;
  return (
    <div class="receipt-upload">
      <label class={`secondary small file-btn${reading ? ' is-busy' : ''}`}>
        <input type="file" accept="image/*" class="sr-only" disabled={reading} onChange={(event) => pick(event.currentTarget.files?.[0])} />
        <span>{reading ? t.receiptReading : `📷 ${t.receiptUpload}`}</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={localOnly} onChange={(event) => toggleLocal(event.currentTarget.checked)} />
        <span>{t.receiptLocalOnly}</span>
      </label>
      <p class="help">{localOnly ? t.receiptPrivacyLocal : t.receiptPrivacy}</p>
    </div>
  );
}

export function ExpensesCard() {
  const current = group.value!;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<Splitting | null>(null);
  const editing = current.expenses.find((expense) => expense.id === editingId);
  const openExpense = (id: string) => {
    if (readOnly.value) return setEditingId(id === editingId ? null : id);
    const expense = current.expenses.find((item) => item.id === id);
    if (expense?.items?.length) setSplitting({ expense });
    else setEditingId(id);
  };
  return (
    <section class="card expenses" aria-labelledby="expensesTitle">
      <div class="section-head">
        <h3 id="expensesTitle">{t.expenses}</h3>
        {current.expenses.length > 0 && <span class="section-total">{money(totals.value!.spent, current.currency)}</span>}
      </div>
      {splitting ? (
        <ReceiptSplitter key={splitting.expense?.id ?? 'new'} splitting={splitting} onDone={() => setSplitting(null)} />
      ) : (
        <>
          <ReceiptButton onRead={setSplitting} />
          <ExpenseEditor editing={editing} onDone={() => setEditingId(null)} />
        </>
      )}
      <ExpenseList editingId={editingId} onEdit={openExpense} />
    </section>
  );
}
