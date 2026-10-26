// Gliederung: zeigt die Überschriften der aktuellen Notiz in der Seitenleiste
export default {
  id: 'outline',
  name: 'Gliederung',
  description: 'Überschriften der aktuellen Notiz in der Seitenleiste',
  activate(app) {
    const { h } = app.ui;
    let container;
    const strip = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim(); };
    const draw = () => {
      if (!container) return;
      container.innerHTML = '';
      const heads = (app.note?.blocks || []).filter((b) => /^h[123]$/.test(b.type) && strip(b.data.text));
      container.parentElement.style.display = heads.length ? '' : 'none';
      for (const b of heads) {
        container.append(h('button.outline-item', {
          text: strip(b.data.text), style: { paddingLeft: 12 + (Number(b.type[1]) - 1) * 14 + 'px' },
          onclick: () => app.editor.rowEl(b.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }));
      }
    };
    app.registerSidebarPanel({
      id: 'outline', title: 'Gliederung',
      render(el) { container = el; el.classList.add('outline'); draw(); }
    });
    let t;
    app.on('note:open', draw);
    app.on('note:change', () => { clearTimeout(t); t = setTimeout(draw, 400); });
  }
};
