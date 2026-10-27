// Zeigt Wörter, Zeichen und Lesezeit in der oberen Leiste an
export default {
  id: 'word-count',
  name: 'Wortzähler',
  description: 'Wörter, Zeichen und geschätzte Lesezeit der aktuellen Notiz',
  activate(app) {
    const el = app.ui.h('div.status-chip', { title: 'Wörter · Lesezeit' });
    app.addStatusItem('word-count', el);
    const update = () => {
      if (!app.note) { el.textContent = ''; return; }
      const text = app.editor.plainText();
      const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
      const minutes = Math.max(1, Math.round(words / 220));
      el.textContent = `${words} Wörter · ${minutes} Min.`;
      el.title = `${text.replace(/\s/g, '').length} Zeichen (ohne Leerzeichen)`;
    };
    let t;
    app.on('note:open', update);
    app.on('note:change', () => { clearTimeout(t); t = setTimeout(update, 300); });
  }
};
