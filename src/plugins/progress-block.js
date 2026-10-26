// Beispiel für einen eigenen Blocktyp: Fortschrittsbalken mit Schieberegler
export default {
  id: 'progress-block',
  name: 'Fortschrittsbalken',
  description: 'Neuer Blocktyp: Fortschritt in Prozent',
  activate(app) {
    const { h } = app.ui;
    app.registerBlock({
      type: 'progress', name: 'Fortschritt', icon: 'progress', group: 'Medien',
      description: 'Fortschrittsbalken mit Prozentangabe', keywords: ['progress', 'balken', 'prozent', 'status'],
      create: () => ({ value: 40, label: 'Fortschritt' }),
      render(block, ctx) {
        const fill = h('div.progress-fill', { style: { width: block.data.value + '%' } });
        const pct = h('span.progress-pct', { text: block.data.value + '%' });
        const label = h('div.progress-label.editable', { contenteditable: 'true', 'data-field': 'label', 'data-placeholder': 'Bezeichnung' });
        label.innerHTML = block.data.label || '';
        const range = h('input.progress-range', { type: 'range', min: 0, max: 100, value: block.data.value });
        range.addEventListener('input', () => {
          fill.style.width = range.value + '%';
          pct.textContent = range.value + '%';
          fill.classList.toggle('done', +range.value === 100);
          ctx.update({ value: +range.value }, { commit: false });
        });
        range.addEventListener('change', () => ctx.update({}, { commit: true }));
        if (block.data.value === 100) fill.classList.add('done');
        return h('div.progress-block', {}, h('div.progress-head', {}, label, pct), h('div.progress-track', {}, fill, range));
      },
      toMarkdown: (b) => `**${b.data.label || 'Fortschritt'}:** ${b.data.value}%`
    });
  }
};
