import { es } from '../../i18n/es';
import { EmojiPicker } from './EmojiPicker';
import { edit, group, preview, readOnly } from './store';

const t = es.group;

function ReadOnlyHeader() {
  const current = group.value!;
  return (
    <section class="group-head">
      <span class="emoji-current" aria-hidden="true">
        {current.emoji}
      </span>
      <div class="game-id">
        <h2 class="game-title">{current.title.trim() || t.unnamed}</h2>
        <p class="game-meta">{preview.value ? `👀 ${es.preview.badge} · ${es.preview.hint}` : t.viewerBadge}</p>
      </div>
    </section>
  );
}

export function GroupHeader() {
  const current = group.value!;
  if (readOnly.value) return <ReadOnlyHeader />;
  return (
    <section class="group-head">
      <EmojiPicker
        value={current.emoji}
        palette={current.palette}
        onPick={(emoji) => edit((draft) => ({ ...draft, emoji }))}
        onPalette={(palette) => edit((draft) => ({ ...draft, palette }))}
      />
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
    </section>
  );
}
