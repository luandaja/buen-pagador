// Monta el HTML real de una página de Astro sobre un DOM de happy-dom.
// Los tests de integración corren en entorno Node: primero se renderiza la
// página con la API de contenedor y después se registra el DOM global.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { vi } from 'vitest';

export async function renderPage(page: AstroComponentFactory): Promise<string> {
  const container = await AstroContainer.create();
  return (await container.renderToString(page))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link\b[^>]*>/g, '');
}

/** Registra un DOM nuevo con el HTML de la página en la URL indicada. */
export function mount(html: string, url: string) {
  GlobalRegistrator.register({ url, settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>/i, '');
}

export async function unmount() {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
}

/** Espera a que una condición se cumpla (los guardados usan debounce). */
export const eventually = (fn: () => void, timeout = 4000) => vi.waitFor(fn, { timeout, interval: 20 });

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function click(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

export function input(el: HTMLInputElement | HTMLSelectElement, value: string, type = 'input') {
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}
