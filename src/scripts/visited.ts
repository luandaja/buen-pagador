// Public links opened on this device, so a payer can find their games again from the home page.
export interface Visit {
  id: string;
  key: string;
  title: string;
  seenAt: number;
}

const KEY = 'buen-pagador:visited';
const MAX_VISITS = 30;

export function listVisits(): Visit[] {
  try {
    const visits = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(visits) ? visits : [];
  } catch {
    return [];
  }
}

function saveVisits(visits: Visit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(visits.slice(0, MAX_VISITS)));
  } catch {
    return;
  }
}

export function rememberVisit(visit: Visit) {
  saveVisits([visit, ...listVisits().filter((saved) => saved.id !== visit.id)]);
}

export function forgetVisit(id: string) {
  saveVisits(listVisits().filter((saved) => saved.id !== id));
}
