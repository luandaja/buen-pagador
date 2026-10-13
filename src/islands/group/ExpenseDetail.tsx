import { useEffect, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { expenseShares, fromCents, type Expense, type Person, type ReceiptItem } from '../../scripts/group/model';
import { ReceiptPhoto, receiptCenter } from './ReceiptPhoto';
import { findReceipt } from './receipts';
import { group } from './store';

const t = es.group;

const namesOf = (ids: string[], people: Person[]) =>
  ids
    .map((id) => people.find((person) => person.id === id)?.name)
    .filter(Boolean)
    .join(', ');

function usePhoto(expenseId: string): string | null {
  const groupId = group.value!.id;
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    void findReceipt(groupId, expenseId).then(setPhoto);
  }, [groupId, expenseId]);
  return photo;
}

type ItemProps = { item: ReceiptItem; people: Person[]; currency: string; active: boolean; canLocate: boolean; onLocate: () => void };

function ItemLine({ item, people, currency, active, canLocate, onLocate }: ItemProps) {
  const owners = namesOf(item.for, people);
  return (
    <li class={`detail-item${active ? ' is-active' : ''}`}>
      {canLocate && (
        <button type="button" class="receipt-locate" aria-label={t.receiptLocate(item.what)} aria-pressed={active} title={t.receiptLocate(item.what)} onClick={onLocate}>
          📍
        </button>
      )}
      <span class="detail-item-text">
        <strong>{item.what}</strong>
        <span class={owners ? '' : 'is-orphan'}>{owners || t.detailUnassigned}</span>
      </span>
      <span class="detail-amount">{money(item.amount, currency)}</span>
    </li>
  );
}

function Items({ expense, people, currency, photo, activeId, onLocate }: { expense: Expense; people: Person[]; currency: string; photo: string | null; activeId: string | null; onLocate: (id: string) => void }) {
  if (!expense.items?.length) return null;
  return (
    <div class="detail-block">
      <span class="field-label">{t.detailItems}</span>
      <ul class="detail-list">
        {expense.items.map((item) => (
          <ItemLine key={item.id} item={item} people={people} currency={currency} active={item.id === activeId} canLocate={!!(photo && item.band)} onLocate={() => onLocate(item.id)} />
        ))}
        {!!expense.tip && (
          <li class="detail-item">
            <span class="detail-item-text">
              <strong>{t.receiptTip}</strong>
            </span>
            <span class="detail-amount">{money(expense.tip, currency)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function Shares({ expense, people, currency }: { expense: Expense; people: Person[]; currency: string }) {
  const shares = [...expenseShares(expense, people)].filter(([, cents]) => cents > 0);
  return (
    <div class="detail-block">
      <span class="field-label">{t.detailShares}</span>
      <ul class="detail-list">
        {shares.map(([id, cents]) => (
          <li key={id} class="detail-item">
            <span class="detail-item-text">{namesOf([id], people)}</span>
            <span class="detail-amount">{money(fromCents(cents), currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExpenseDetail({ expense }: { expense: Expense }) {
  const { people, currency } = group.value!;
  const photo = usePhoto(expense.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const band = expense.items?.find((item) => item.id === activeId)?.band;
  return (
    <div class="expense-detail" id={`detail-${expense.id}`}>
      {expense.note && <p class="detail-note">{expense.note}</p>}
      {photo && <ReceiptPhoto photo={photo} band={band} center={receiptCenter((expense.items ?? []).map((item) => item.band))} />}
      <Items expense={expense} people={people} currency={currency} photo={photo} activeId={activeId} onLocate={setActiveId} />
      <Shares expense={expense} people={people} currency={currency} />
    </div>
  );
}
