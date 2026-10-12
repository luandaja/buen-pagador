import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { collectorOf } from '../../scripts/group/model';
import { qrFromFile } from '../../scripts/image';
import { edit, group } from './store';

const t = es.group;
const COPIED_MS = 1500;

const collectorName = () => collectorOf(group.value!)?.name ?? '';

export function PayDetails() {
  const current = group.value!;
  const [error, setError] = useState('');
  const pickQr = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payQr = await qrFromFile(file);
      edit((draft) => ({ ...draft, payQr }));
      setError('');
    } catch {
      setError(es.pay.qrError);
    }
  };
  return (
    <section class="pay-details" aria-labelledby="payDetailsTitle">
      <div class="field">
        <label id="payDetailsTitle" for="groupPayNote">
          {t.payTitle(collectorName())} <span class="optional">{es.pay.optional}</span>
        </label>
        <textarea id="groupPayNote" rows={2} maxLength={160} value={current.payNote ?? ''} placeholder={es.pay.placeholder} onInput={(event) => edit((draft) => ({ ...draft, payNote: event.currentTarget.value }))} />
      </div>
      <div class="qr-field">
        {current.payQr && <img class="qr-preview" src={current.payQr} alt={es.pay.qrAlt} />}
        <label class="secondary small file-btn">
          <input type="file" accept="image/*" class="sr-only" onChange={(event) => pickQr(event.currentTarget.files?.[0])} />
          <span>{current.payQr ? es.pay.changeQr : es.pay.uploadQr}</span>
        </label>
        {current.payQr && (
          <button type="button" class="link danger" onClick={() => edit((draft) => ({ ...draft, payQr: null }))}>
            {es.pay.removeQr}
          </button>
        )}
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PayNote({ note }: { note: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(note);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <>
      <p class="pay-note">{note}</p>
      <button type="button" class="secondary small" onClick={copy}>
        {copied ? t.copied : es.pay.copy}
      </button>
    </>
  );
}

function PayQr({ qr }: { qr: string }) {
  return (
    <figure class="pay-qr">
      <img src={qr} alt={es.pay.qrPublicAlt} />
      <figcaption>
        <a class="secondary small qr-download" href={qr} download={es.pay.qrFileName}>
          {es.pay.saveQr}
        </a>
        <span>{es.pay.qrHelp}</span>
      </figcaption>
    </figure>
  );
}

export function PayBox() {
  const { payNote, payQr } = group.value!;
  const note = payNote?.trim() ?? '';
  if (!note && !payQr) return null;
  return (
    <section class="pay-box" aria-labelledby="groupPayTitle">
      <h3 id="groupPayTitle">{t.payPublicTitle(collectorName())}</h3>
      {note && <PayNote note={note} />}
      {payQr && <PayQr qr={payQr} />}
    </section>
  );
}
