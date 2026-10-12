import { loadGame } from './games';
import { hasPay, payOf, toShared, type PayInfo, type SharedState } from './share';
import { loadPrefs } from './state';



export interface Preview {
  shared: SharedState;
  image: string;
  pay: PayInfo | null;
}

export async function loadPreview(): Promise<Preview | null> {
  const { currentGameId, includePhoto, blocked } = loadPrefs();
  const game = currentGameId ? await loadGame(currentGameId) : null;
  if (!game?.image) return null;
  const pay = payOf(game);
  return { shared: toShared({ ...game, includePhoto, blocked }), image: game.image, pay: hasPay(pay) ? pay : null };
}
