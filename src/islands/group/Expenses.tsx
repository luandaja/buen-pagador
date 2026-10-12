import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { amongText, payerName } from '../../scripts/group/text';
import { ExpenseForm } from './ExpenseForm';
import { group, totals } from './store';

const t = es.group;

function ExpenseList({ editingId, onEdit }: { editingId: string | null; onEdit: (id: string) => void }) {
  const current = group.value!;
  if (current.expenses.length === 0) return current.people.length ? <p class="help">{t.noExpenses}</p> : null;
  return (
    <ul class="expense-list">
      {[...current.expenses].reverse().map((expense) => (
        <li key={expense.id}>
          <button
            type="button"
            class="expense-row"
            aria-current={expense.id === editingId}
            aria-label={t.edit(expense.what)}
            onClick={() => onEdit(expense.id)}
          >
            <span class="expense-text">
              <strong>{expense.what}</strong>
              <span>
                {t.paidBy(payerName(expense, current.people))} · {amongText(expense, current.people)}
              </span>
            </span>
            <span class="expense-amount">{money(expense.amount, current.currency)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ExpensesCard() {
  const current = group.value!;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = current.expenses.find((expense) => expense.id === editingId);
  const hasPeople = current.people.length > 0;
  return (
    <section class="card expenses" aria-labelledby="expensesTitle">
      <div class="section-head">
        <h3 id="expensesTitle">{t.expenses}</h3>
        {current.expenses.length > 0 && <span class="section-total">{money(totals.value!.spent, current.currency)}</span>}
      </div>
      {hasPeople ? (
        <ExpenseForm key={editing?.id ?? `new-${current.people.length}`} editing={editing} onDone={() => setEditingId(null)} />
      ) : (
        <p class="help">{t.needPeople}</p>
      )}
      <ExpenseList editingId={editingId} onEdit={setEditingId} />
    </section>
  );
}
