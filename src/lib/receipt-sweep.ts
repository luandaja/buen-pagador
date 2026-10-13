import type { GroupStore } from './group-store';
import { receiptFolder, type ReceiptStore } from './receipt-store';

export const SWEEP_BATCH = 200;

// Deletes the photos of groups Redis already expired; groups renewed since they were tracked get their new due date.
export async function sweepReceipts(groups: GroupStore, receipts: ReceiptStore, now = Date.now()) {
  const result = { removed: 0, renewed: 0 };
  for (const id of await groups.dueReceipts(now, SWEEP_BATCH)) {
    const ttl = await groups.ttl(id);
    if (ttl) {
      await groups.trackReceipts(id, now + ttl * 1000);
      result.renewed++;
      continue;
    }
    await receipts.removeFolder(receiptFolder(id));
    await groups.untrackReceipts(id);
    result.removed++;
  }
  return result;
}
