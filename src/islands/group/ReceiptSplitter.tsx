import { useEffect, useState } from 'preact/hooks';
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
  locateDraft,
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
import { ocrOnDevice } from '../../scripts/group/read-receipt';
import { loadReceipt } from '../../scripts/group/receipts';
import { AmongPicker, storeReceipt } from './ExpenseForm';
import { ReceiptPhoto, receiptCenter } from './ReceiptPhoto';
import { edit, group } from './store';

const t = es.group;

export type Splitting = { expense?: Expense; read?: ReadReceipt; failed?: boolean };

type ItemProps = {
  item: DraftItem;
  people: Person[];
  active: boolean;
  canLocate: boolean;
  onChange: (patch: Partial<DraftItem>) => void;
  onSplit: () => void;
  onRemove: () => void;
  onLocate: () => void;
};

const MAX_QUANTITY = 99;

function QuantityRow({ item, name, onChange, onSplit }: { item: DraftItem; name: string; onChange: (patch: Partial<DraftItem>) => void; onSplit: () => void }) {
  const quantity = item.quantity;
  return (
    <div class="receipt-quantity">
      <span class="field-label">{t.receiptQuantity}</span>
      <button type="button" class="icon-btn small" aria-label={t.receiptQuantityLess(name)} disabled={quantity <= 1} onClick={() => onChange({ quantity: quantity - 1 })}>
        −
      </button>
      <span class="quantity-value">×{quantity}</span>
      <button type="button" class="icon-btn small" aria-label={t.receiptQuantityMore(name)} disabled={quantity >= MAX_QUANTITY} onClick={() => onChange({ quantity: quantity + 1 })}>
        +
      </button>
      {quantity > 1 && (
        <button type="button" class="link" onClick={onSplit}>
          {t.receiptSplitUnits(quantity)}
        </button>
      )}
    </div>
  );
}

const itemClass = (item: DraftItem, active: boolean) => `receipt-item${item.for.length ? '' : ' is-orphan'}${active ? ' is-active' : ''}`;

function ItemRow({ item, people, active, canLocate, onChange, onSplit, onRemove, onLocate }: ItemProps) {
  const name = item.what || t.receiptNewItem;
  return (
    <li class={itemClass(item, active)} onFocusIn={onLocate}>
      <div class="receipt-item-head">
        {canLocate && (
          <button type="button" class="receipt-locate" aria-label={t.receiptLocate(name)} aria-pressed={active} title={t.receiptLocate(name)} onClick={onLocate}>
            📍
          </button>
        )}
        <input class="receipt-item-name" aria-label={t.receiptItemName} value={item.what} maxLength={60} onInput={(event) => onChange({ what: event.currentTarget.value })} />
        <input class="receipt-item-amount" aria-label={`${t.receiptItemAmount} ${name}`} inputMode="decimal" value={item.amount} onInput={(event) => onChange({ amount: event.currentTarget.value })} />
        <button type="button" class="person-remove" aria-label={t.receiptRemoveItem(name)} onClick={onRemove}>
          ×
        </button>
      </div>
      <QuantityRow item={item} name={name} onChange={onChange} onSplit={onSplit} />
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

function ReceiptHead({ draft, people, onDraft }: { draft: ReceiptDraft; people: Person[]; onDraft: (draft: ReceiptDraft) => void }) {
  return (
    <>
      <div class="field">
        <label for="receiptWhat">{t.what}</label>
        <input id="receiptWhat" value={draft.what} maxLength={60} onInput={(event) => onDraft({ ...draft, what: event.currentTarget.value })} />
      </div>
      <div class="field">
        <label for="receiptBy">{t.receiptPayer}</label>
        <select id="receiptBy" value={draft.by} onChange={(event) => onDraft({ ...draft, by: event.currentTarget.value })}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function Progress({ draft, orphans }: { draft: ReceiptDraft; orphans: number }) {
  return (
    <>
      <p class="receipt-progress">
        {t.receiptAssigned(draft.items.length - orphans, draft.items.length)}
        {orphans > 0 && <span class="receipt-orphans"> · {t.receiptOrphans(orphans)}</span>}
      </p>
      {orphans > 0 && <p class="help">{t.receiptOrphansHelp}</p>}
    </>
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

function usePhoto(splitting: Splitting, groupId: string): string | null {
  const [photo, setPhoto] = useState<string | null>(splitting.read?.photo ?? null);
  useEffect(() => {
    if (splitting.expense) void loadReceipt(groupId, splitting.expense.id).then(setPhoto);
  }, [splitting.expense?.id]);
  return photo;
}

function useLocate(photo: string | null, needed: boolean, setDraft: (update: (draft: ReceiptDraft) => ReceiptDraft) => void) {
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (!photo || !needed) return;
    let active = true;
    setLocating(true);
    ocrOnDevice(photo)
      .then((lines) => active && setDraft((draft) => ({ ...draft, items: locateDraft(draft.items, lines) })))
      .catch(() => undefined)
      .finally(() => active && setLocating(false));
    return () => {
      active = false;
    };
  }, [photo]);
  return locating;
}

export function ReceiptSplitter({ splitting, onDone }: { splitting: Splitting; onDone: () => void }) {
  const current = group.value!;
  const people = current.people;
  const [draft, setDraft] = useState(() => initialDraft(splitting, people));
  const [activeId, setActiveId] = useState<string | null>(null);
  const photo = usePhoto(splitting, current.id);
  const locating = useLocate(photo, draft.items.some((item) => !item.band), setDraft);
  const activeBand = draft.items.find((item) => item.id === activeId)?.band;
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
    <section class={`receipt-splitter${photo ? ' has-photo' : ''}`} aria-labelledby="receiptTitle">
      {photo && <ReceiptPhoto photo={photo} band={activeBand} center={receiptCenter(draft.items.map((item) => item.band))} />}
      {locating && (
        <p class="help" role="status">
          {t.receiptLocating}
        </p>
      )}
      <div class="section-head">
        <h3 id="receiptTitle">{t.receiptTitle}</h3>
      </div>
      {sourceText(splitting) && <p class="help">{sourceText(splitting)}</p>}
      <ReceiptHead draft={draft} people={people} onDraft={setDraft} />
      <Progress draft={draft} orphans={check.orphans} />
      <ul class="receipt-items">
        {draft.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            people={people}
            active={item.id === activeId}
            canLocate={!!(photo && item.band)}
            onLocate={() => setActiveId(item.id)}
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
