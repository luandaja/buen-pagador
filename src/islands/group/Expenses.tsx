import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { amongText, payerName } from '../../scripts/group/text';
import { ExpenseForm } from './ExpenseForm';
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
            <div class="expense-row">
              <ExpenseContent expense={expense} people={current.people} currency={current.currency} />
            </div>
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

export function ExpensesCard() {
  const current = group.value!;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = current.expenses.find((expense) => expense.id === editingId);
  return (
    <section class="card expenses" aria-labelledby="expensesTitle">
      <div class="section-head">
        <h3 id="expensesTitle">{t.expenses}</h3>
        {current.expenses.length > 0 && <span class="section-total">{money(totals.value!.spent, current.currency)}</span>}
      </div>
      <ExpenseEditor editing={editing} onDone={() => setEditingId(null)} />
      <ExpenseList editingId={editingId} onEdit={setEditingId} />
    </section>
  );
}
