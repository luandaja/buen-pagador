import { useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import { groupEditUrl, groupPublicUrl } from '../../scripts/group/remote';
import type { GroupLink } from '../../scripts/group/model';
import { summaryText } from '../../scripts/group/text';
import { expiryText } from '../../scripts/links';
import { group } from './store';
import { startSharing, stopSharing, syncStatus } from './sync';

const t = es.group;
const COPIED_MS = 1500;

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <button type="button" class="secondary small" onClick={copy}>
      {copied ? t.copied : label}
    </button>
  );
}

async function shareOrCopy(title: string, text: string): Promise<boolean> {
  if (!navigator.share) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  try {
    await navigator.share({ title, text });
  } catch {
    return false;
  }
  return false;
}

function SummaryButton() {
  const current = group.value!;
  const [copied, setCopied] = useState(false);
  if (!current.expenses.length) return null;
  const send = async () => {
    const title = current.title.trim() || t.unnamed;
    const text = summaryText(current, current.share ? groupPublicUrl(current.share) : undefined);
    if (!(await shareOrCopy(t.summaryShareTitle(title), text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <button type="button" class="secondary small" onClick={send}>
      {copied ? t.copied : t.summary}
    </button>
  );
}

function Links({ link }: { link: GroupLink }) {
  const stop = () => {
    if (confirm(link.owner ? t.stopOwnerConfirm : t.stopGuestConfirm)) void stopSharing();
  };
  return (
    <>
      {link.expiresAt && <p class="help link-expiry">{expiryText(link.expiresAt)}</p>}
      <CopyButton label={t.copyEdit} text={groupEditUrl(link)} />
      <CopyButton label={t.copyView} text={groupPublicUrl(link)} />
      <button type="button" class="link danger" onClick={stop}>
        {link.owner ? t.stopOwner : t.stopGuest}
      </button>
    </>
  );
}

export function ShareBox() {
  const link = group.value!.share;
  const status = syncStatus.value;
  return (
    <section class="share group-share" aria-labelledby="groupShareTitle">
      <div class="section-head">
        <h3 id="groupShareTitle">{t.shareTitle}</h3>
        <span class="sync" data-tone={status === 'ok' ? 'ok' : status === 'busy' ? 'busy' : status === 'off' ? '' : 'error'} role="status">
          {t.status[status]}
        </span>
      </div>
      <p class="help">{t.shareHelp}</p>
      <a class="secondary small preview-link" href="/c#preview" target="_blank" rel="noopener">
        <span aria-hidden="true">👀</span>&nbsp;{es.preview.open}
      </a>
      <SummaryButton />
      {link ? (
        <Links link={link} />
      ) : (
        <button type="button" class="primary" disabled={status === 'busy'} onClick={() => startSharing()}>
          {status === 'busy' ? t.shareCreating : t.shareCreate}
        </button>
      )}
    </section>
  );
}
