import { useRef, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { GROUP_EMOJIS, isValidEmoji } from '../../scripts/group/model';

const t = es.group;

type Props = { value: string; onPick: (emoji: string) => void };

export function EmojiPicker({ value, onPick }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [other, setOther] = useState('');

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
      </div>
    </details>
  );
}
