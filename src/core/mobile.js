// Anpassungen für Handys: Seitenleiste als Schublade, Wischgeste, Zurück-Taste, Statusleiste
import { closeMenu } from '../ui/overlays.js';

export const isNarrow = () => matchMedia('(max-width: 760px)').matches;

export function initMobile(app) {
  const api = app.api;
  if (api.isMobile) document.body.classList.add('is-mobile');
  if (api.isWeb) document.body.classList.add('is-web');
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

  // Hintergrund zum Schließen der Seitenleiste
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.addEventListener('click', () => setDrawer(false));
  document.body.append(backdrop);

  function setDrawer(open) {
    document.body.classList.toggle('sidebar-open', open);
    if (open) document.activeElement?.blur?.();
  }
  app.setDrawer = setDrawer;

  // Notiz geöffnet → Schublade schließen
  app.events.on('note:open', () => { if (isNarrow()) setDrawer(false); });

  // Vom linken Rand nach rechts wischen öffnet die Seitenleiste, nach links schließt sie
  let touch = null;
  document.addEventListener('touchstart', (e) => {
    if (!isNarrow() || e.touches.length !== 1) return;
    const t = e.touches[0];
    const open = document.body.classList.contains('sidebar-open');
    if ((!open && t.clientX < 24) || open) touch = { x: t.clientX, y: t.clientY, open };
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = Math.abs(t.clientY - touch.y);
    if (dy < 60) {
      if (!touch.open && dx > 60) setDrawer(true);
      if (touch.open && dx < -60) setDrawer(false);
    }
    touch = null;
  }, { passive: true });

  if (!api.native) return;

  // Android-Zurück-Taste: erst Menüs/Dialoge schließen, dann Seitenleiste, dann App minimieren
  api.plugins.App.addListener('backButton', () => {
    const esc = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) || document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.querySelector('.menu')) { closeMenu(); document.querySelector('.slash-menu') && esc(); return; }
    if (document.querySelector('.modal-backdrop, .palette-backdrop, .lightbox')) {
      const lb = document.querySelector('.lightbox');
      if (lb) { lb.click(); return; }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    if (document.body.classList.contains('sidebar-open')) { setDrawer(false); return; }
    if (app.drawMode) { app.toggleDrawMode(false); return; }
    if (document.activeElement && document.activeElement !== document.body) { document.activeElement.blur(); return; }
    if (isNarrow()) { setDrawer(true); return; }
    api.plugins.App.minimizeApp();
  });

  // Beim Wechsel in den Hintergrund sofort speichern
  api.plugins.App.addListener('pause', () => app.saveNow());

  // Hinweis, wenn Android die Installation von Updates erst erlauben muss
  api.on('update:needsPermission', () => {
    import('../ui/overlays.js').then(({ toast }) => toast('Bitte „Apps aus dieser Quelle zulassen“ für AleNote aktivieren und dann zurückkehren', { duration: 7000 }));
  });
}
