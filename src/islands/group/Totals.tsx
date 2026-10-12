import { es } from '../../i18n/es';
import { money } from '../../scripts/state';
import { group, totals } from './store';

const t = es.group;

export function Totals() {
  const sum = totals.value!;
  if (sum.spent === 0) return null;
  const { currency } = group.value!;
  const done = sum.peopleToSettle > 0 && sum.settledPeople === sum.peopleToSettle;
  const percent = sum.peopleToSettle ? Math.round((sum.settledPeople / sum.peopleToSettle) * 100) : 0;
  return (
    <section class={`progress group-progress${done ? ' is-full' : ''}`} aria-labelledby="groupProgressLabel">
      <div class="progress-head">
        <p class="progress-label" id="groupProgressLabel">
          {t.missing}
        </p>
        <p class="progress-count">
          <span class="progress-fraction">
            {sum.settledPeople}/{sum.peopleToSettle}
          </span>{' '}
          {t.settledCount}
        </p>
      </div>
      <p class="progress-hero">{done ? t.allSettled : money(sum.pending, currency)}</p>
      <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={es.progress.meter} style={`--pct:${percent / 100};--n:${Math.max(sum.peopleToSettle, 1)}`}>
        <div class="meter-track">
          <div class="meter-fill" />
        </div>
      </div>
      <p class="progress-sub">
        <span>
          {t.spent} <b>{money(sum.spent, currency)}</b>
        </span>
      </p>
    </section>
  );
}
