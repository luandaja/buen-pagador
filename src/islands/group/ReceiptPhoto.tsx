import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { es } from '../../i18n/es';
import type { Band } from '../../scripts/group/model';

const t = es.group;

export const LENS_ZOOMS = [1, 1.5, 2, 3, 4, 5];
export const VIEWER_ZOOMS = [1, 1.5, 2, 3, 4, 6];

type Size = { width: number; height: number };
export function receiptCenter(bands: (Band | undefined)[]): number | undefined {
  const centers = bands
    .filter((band): band is Required<Band> => band?.left != null && band.right != null)
    .map((band) => (band.left + band.right) / 2)
    .sort((first, second) => first - second);
  return centers.length ? centers[Math.floor(centers.length / 2)] : undefined;
}

export function lensOffset(lens: Size, image: Size, band: Band | undefined, center = 0.5) {
  const centerX = center;
  const centerY = band ? (band.top + band.bottom) / 2 : 0.5;
  const fit = (view: number, length: number, center: number) =>
    length <= view ? (view - length) / 2 : Math.min(0, Math.max(view - length, view / 2 - center * length));
  return { x: fit(lens.width, image.width, centerX), y: fit(lens.height, image.height, centerY) };
}

function useSize(ref: { current: HTMLElement | null }): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return size;
}

function BandMark({ band }: { band?: Band }) {
  if (!band) return null;
  const style = `top:${(band.top * 100).toFixed(1)}%;height:${((band.bottom - band.top) * 100).toFixed(1)}%`;
  return <div class="receipt-band" aria-hidden="true" style={style} />;
}

function Lens({ photo, band, center, zoom }: { photo: string; band?: Band; center?: number; zoom: number }) {
  const lens = useRef<HTMLDivElement>(null);
  const size = useSize(lens);
  const [ratio, setRatio] = useState(0);
  const image = { width: size.width * zoom, height: size.width * zoom * ratio };
  const offset = ratio && size.width ? lensOffset(size, image, band, center) : { x: 0, y: 0 };
  const style = ratio && size.width ? `width:${image.width}px;height:${image.height}px;transform:translate(${offset.x}px,${offset.y}px)` : 'width:100%';
  return (
    <div class="receipt-lens" ref={lens}>
      <div class="receipt-lens-image" style={style}>
        <img src={photo} alt={t.receiptPhotoAlt} onLoad={(event) => setRatio(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth || 0)} />
        <BandMark band={band} />
      </div>
    </div>
  );
}

function ZoomControls({ zooms, index, onChange }: { zooms: number[]; index: number; onChange: (index: number) => void }) {
  return (
    <span class="zoom-controls">
      <button type="button" class="icon-btn small" aria-label={t.receiptZoomOut} disabled={index === 0} onClick={() => onChange(index - 1)}>
        −
      </button>
      <span class="zoom-level" aria-live="polite">
        {zooms[index]}×
      </span>
      <button type="button" class="icon-btn small" aria-label={t.receiptZoomIn} disabled={index === zooms.length - 1} onClick={() => onChange(index + 1)}>
        +
      </button>
    </span>
  );
}

function Viewer({ photo, band, onClose }: { photo: string; band?: Band; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    dialog.current!.showModal?.();
  }, []);
  useEffect(() => {
    const element = scroller.current!;
    const middle = band ? ((band.top + band.bottom) / 2) * element.scrollHeight : 0;
    element.scrollTo?.({ top: Math.max(0, middle - element.clientHeight / 2), left: (element.scrollWidth - element.clientWidth) / 2 });
  }, [index]);
  return (
    <dialog class="receipt-viewer" ref={dialog} aria-label={t.receiptPhotoAlt} onClose={onClose}>
      <div class="receipt-viewer-bar">
        <ZoomControls zooms={VIEWER_ZOOMS} index={index} onChange={setIndex} />
        <button type="button" class="secondary small" onClick={onClose}>
          {t.receiptClose}
        </button>
      </div>
      <div class="receipt-viewer-scroll" ref={scroller}>
        <div class="receipt-viewer-image" style={`width:${VIEWER_ZOOMS[index] * 100}%`}>
          <img src={photo} alt="" />
          <BandMark band={band} />
        </div>
      </div>
    </dialog>
  );
}

export function ReceiptPhoto({ photo, band, center }: { photo: string; band?: Band; center?: number }) {
  const [index, setIndex] = useState(2);
  const [open, setOpen] = useState(false);
  return (
    <figure class="receipt-photo">
      <Lens photo={photo} band={band} center={center} zoom={LENS_ZOOMS[index]} />
      <figcaption>
        <ZoomControls zooms={LENS_ZOOMS} index={index} onChange={setIndex} />
        <button type="button" class="link" onClick={() => setOpen(true)}>
          {t.receiptOpen}
        </button>
        <span class="receipt-photo-help">{t.receiptPhotoHelp}</span>
      </figcaption>
      {open && <Viewer photo={photo} band={band} onClose={() => setOpen(false)} />}
    </figure>
  );
}
