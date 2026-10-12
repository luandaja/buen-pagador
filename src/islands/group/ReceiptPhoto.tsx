import { useEffect, useRef, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import type { Band } from '../../scripts/group/model';

const t = es.group;

function center(scroller: HTMLElement, frame: HTMLElement, band?: Band) {
  const left = Math.max(0, (frame.offsetWidth - scroller.clientWidth) / 2);
  const middle = band ? ((band.top + band.bottom) / 2) * frame.offsetHeight : scroller.scrollTop + scroller.clientHeight / 2;
  scroller.scrollTo({ left, top: Math.max(0, middle - scroller.clientHeight / 2), behavior: 'smooth' });
}

export function ReceiptPhoto({ photo, band }: { photo: string; band?: Band }) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    center(scroller.current!, frame.current!, band);
  }, [band?.top, band?.bottom, zoomed]);

  return (
    <figure class="receipt-photo">
      <div class="receipt-photo-scroll" ref={scroller}>
        <div class={`receipt-photo-frame${zoomed ? ' is-zoomed' : ''}`} ref={frame}>
          <img src={photo} alt={t.receiptPhotoAlt} />
          {band && <div class="receipt-band" aria-hidden="true" style={`top:${(band.top * 100).toFixed(1)}%;height:${((band.bottom - band.top) * 100).toFixed(1)}%`} />}
        </div>
      </div>
      <figcaption>
        <button type="button" class="link" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>
          {zoomed ? t.receiptZoomOut : t.receiptZoomIn}
        </button>
        <span>{t.receiptPhotoHelp}</span>
      </figcaption>
    </figure>
  );
}
