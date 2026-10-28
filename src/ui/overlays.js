// Toasts, Dialoge und Kontextmenüs
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { shortcutHtml } from '../core/shortcuts.js';

// ---------- Toast ----------
let toastHost;
export function toast(message, { type = 'info', duration = 2600, action } = {}) {
  if (!toastHost) toastHost = document.body.appendChild(h('div.toast-host'));
  const ico = { info: 'zap', success: 'check', error: 'x' }[type] || 'zap';
  const el = h('div.toast.toast-' + type, {}, icon(ico, 15), h('span', { text: message }));
  const hide = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); };
  // Optionaler Knopf, z.B. „Rückgängig“
  if (action) el.append(h('button.toast-action', { text: action.label, onclick: () => { hide(); action.run(); } }));
  toastHost.append(el);
  setTimeout(hide, duration);
}

// ---------- Modal ----------
export function modal({ title, content, actions = [], width = 440, onClose, className = '' }) {
  const backdrop = h('div.modal-backdrop');
  const box = h('div.modal' + (className ? '.' + className : ''), { style: { width: typeof width === 'number' ? width + 'px' : width } });
  const close = (value) => {
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 220);
    document.removeEventListener('keydown', onKey, true);
    onClose?.(value);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
  document.addEventListener('keydown', onKey, true);
  if (title) box.append(h('div.modal-header', {}, h('h3', { text: title }), h('button.icon-btn', { onclick: () => close(null), title: 'Schließen' }, icon('x', 16))));
  const body = h('div.modal-body');
  if (content) body.append(content);
  box.append(body);
  if (actions.length) {
    const foot = h('div.modal-footer');
    for (const a of actions) foot.append(h('button.btn' + (a.primary ? '.btn-primary' : '') + (a.danger ? '.btn-danger' : ''), { text: a.label, onclick: () => (a.run ? a.run(close) : close(a.value)) }));
    box.append(foot);
  }
  backdrop.append(box);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });
  document.body.append(backdrop);
  return { close, box, body };
}

export function prompt(title, { value = '', placeholder = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const input = h('input.input', { value, placeholder });
    const m = modal({
      title, content: input, width: 400, onClose: (v) => resolve(v),
      actions: [{ label: 'Abbrechen', value: null }, { label: okLabel, primary: true, run: (close) => close(input.value.trim() || null) }]
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.close(input.value.trim() || null); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export function confirmDialog(title, text, { okLabel = 'Löschen', danger = true } = {}) {
  return new Promise((resolve) => {
    modal({
      title, content: h('p.muted', { text }), width: 400, onClose: (v) => resolve(!!v),
      actions: [{ label: 'Abbrechen', value: false }, { label: okLabel, primary: !danger, danger, value: true }]
    });
  });
}

// ---------- Kontextmenü ----------
let openMenu = null;
export function closeMenu() {
  if (openMenu) { const m = openMenu; openMenu = null; m.classList.add('leaving'); setTimeout(() => m.remove(), 150); }
}

/**
 * items: [{ label, icon, shortcut, danger, run, submenu: [...] } | '-' ]
 * pos:   { x, y } oder ein Element, unter dem das Menü erscheint
 */
export function contextMenu(items, pos, { className = '' } = {}) {
  closeMenu();
  const menu = h('div.menu' + (className ? '.' + className : ''));
  const build = (container, list) => {
    for (const item of list) {
      if (!item) continue;
      if (item === '-') { container.append(h('div.menu-sep')); continue; }
      if (item.header) { container.append(h('div.menu-header', { text: item.header })); continue; }
      const row = h('button.menu-item' + (item.danger ? '.danger' : '') + (item.active ? '.active' : ''), {},
        item.icon ? icon(item.icon, 15) : h('span.icon'),
        h('span.menu-label', { text: item.label }),
        item.shortcut ? h('span.menu-shortcut', { html: shortcutHtml(item.shortcut) }) : null,
        item.submenu ? icon('chevronRight', 13, 'menu-arrow') : null);
      if (item.swatch) row.querySelector('.icon').replaceWith(h('span.swatch', { style: { background: item.swatch } }));
      if (item.submenu) {
        const sub = h('div.menu.submenu');
        build(sub, item.submenu);
        row.append(sub);
        row.classList.add('has-sub');
        row.addEventListener('mouseenter', () => {
          sub.style.top = ''; sub.style.left = ''; sub.style.right = '';
          requestAnimationFrame(() => {
            const r = sub.getBoundingClientRect();
            if (r.bottom > innerHeight - 8) sub.style.top = `${-5 - (r.bottom - innerHeight + 8)}px`;
            if (r.right > innerWidth - 8) { sub.style.left = 'auto'; sub.style.right = 'calc(100% + 4px)'; }
          });
        });
      } else {
        row.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); item.run?.(); });
      }
      container.append(row);
    }
  };
  build(menu, items);
  document.body.append(menu);
  let x, y;
  if (pos instanceof Element) { const r = pos.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
  else ({ x, y } = pos);
  const mr = menu.getBoundingClientRect();
  if (x + mr.width > innerWidth - 8) x = innerWidth - mr.width - 8;
  if (y + mr.height > innerHeight - 8) y = Math.max(8, y - mr.height - (pos instanceof Element ? pos.getBoundingClientRect().height + 8 : 0));
  menu.style.left = Math.max(8, x) + 'px';
  menu.style.top = Math.max(8, y) + 'px';
  openMenu = menu;
  return menu;
}

document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { closeMenu(); e.stopPropagation(); } }, true);
window.addEventListener('blur', closeMenu);

// ---------- Popover (frei positionierter Inhalt) ----------
export function popover(content, anchor, { onClose, className = '' } = {}) {
  closeMenu();
  const el = h('div.menu.popover' + (className ? '.' + className : ''), {}, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  let x = r.left, y = r.bottom + 6;
  if (x + er.width > innerWidth - 8) x = innerWidth - er.width - 8;
  if (y + er.height > innerHeight - 8) y = r.top - er.height - 6;
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
  openMenu = el;
  const obs = new MutationObserver(() => { if (!el.isConnected) { obs.disconnect(); onClose?.(); } });
  obs.observe(document.body, { childList: true });
  return el;
}
