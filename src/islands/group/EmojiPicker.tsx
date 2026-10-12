import { useEffect, useRef, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { GROUP_EMOJIS, isValidEmoji } from '../../scripts/group/model';
import { PALETTES } from '../../scripts/palettes';

const t = es.group;

type Props = { value: string; palette: string; onPick: (emoji: string) => void; onPalette: (palette: string) => void };

function PaletteSwatches({ value, onPick }: { value: string; onPick: (palette: string) => void }) {
  return (
    <fieldset class="palette-grid">
      <legend>{t.colors}</legend>
      {PALETTES.map((palette) => (
        <button
          type="button"
          key={palette.id}
          class="swatch"
          aria-pressed={palette.id === value}
          aria-label={t.paletteChoose(palette.name)}
          title={palette.name}
          style={`--swatch-bg:${palette.court};--swatch-ink:${palette.ink};--swatch-accent:${palette.ball}`}
          onClick={() => onPick(palette.id)}
        >
          <span aria-hidden="true" />
        </button>
      ))}
    </fieldset>
  );
}

function useDismiss(menu: { current: HTMLDetailsElement | null }) {
  useEffect(() => {
    const close = (event: Event) => {
      const outside = event.type === 'pointerdown' && !menu.current!.contains(event.target as Node);
      if (outside || (event as KeyboardEvent).key === 'Escape') menu.current!.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
}

export function EmojiPicker({ value, palette, onPick, onPalette }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [other, setOther] = useState('');
  useDismiss(menu);

  const pick = (emoji: string) => {
    onPick(emoji);
    setOther('');
    menu.current!.open = false;
  };

  const onOther = (text: string) => {
    setOther(text);
    if (isValidEmoji(text)) pick(text.trim());
  };

  return (
    <details class="emoji-picker" ref={menu}>
      <summary class="emoji-current" aria-label={t.emoji} title={t.emoji}>
        {value}
      </summary>
      <div class="emoji-menu">
        <div class="emoji-grid">
          {GROUP_EMOJIS.map((emoji) => (
            <button type="button" key={emoji} aria-label={t.emojiChoose(emoji)} aria-pressed={emoji === value} onClick={() => pick(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
        <div class="field">
          <label for="otherEmoji">{t.emojiOther}</label>
          <input id="otherEmoji" value={other} placeholder={t.emojiOtherHint} autocomplete="off" onInput={(event) => onOther(event.currentTarget.value)} />
        </div>
        <PaletteSwatches value={palette} onPick={onPalette} />
      </div>
    </details>
  );
}
