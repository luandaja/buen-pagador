import { es } from '../../i18n/es';

export const faviconHref = (emoji: string) =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`;

export function setPageIdentity(emoji: string, title: string) {
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', faviconHref(emoji));
  document.title = title.trim() ? es.meta.pageTitle(`${emoji} ${title.trim()}`) : es.group.metaTitle;
}
