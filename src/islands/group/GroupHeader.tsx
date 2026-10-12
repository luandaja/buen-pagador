import { es } from '../../i18n/es';
import { EmojiPicker } from './EmojiPicker';
import { edit, group } from './store';

const t = es.group;

export function GroupHeader() {
  const current = group.value!;
  return (
    <section class="group-head">
      <EmojiPicker value={current.emoji} onPick={(emoji) => edit((draft) => ({ ...draft, emoji }))} />
      <div class="field grow">
        <label for="groupTitle">{t.titleLabel}</label>
        <input
          id="groupTitle"
          class="title-input"
          value={current.title}
          maxLength={60}
          autocomplete="off"
          placeholder={t.titlePlaceholder}
          onInput={(event) => edit((draft) => ({ ...draft, title: event.currentTarget.value }))}
        />
      </div>
      <div class="field currency-field">
        <label for="groupCurrency">{t.currency}</label>
        <input
          id="groupCurrency"
          value={current.currency}
          maxLength={4}
          autocomplete="off"
          onInput={(event) => edit((draft) => ({ ...draft, currency: event.currentTarget.value }))}
        />
      </div>
    </section>
  );
}
