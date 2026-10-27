// Rückgängig / Wiederholen pro Notiz
// Jeder Eintrag: { snap: Notizinhalt als JSON, sel: Cursorposition zum Zeitpunkt der Änderung }

export class History {
  constructor(limit = 300) {
    this.limit = limit;
    this.reset(null);
  }

  reset(snap, sel = null) {
    this.stack = snap ? [{ snap, sel }] : [];
    this.index = this.stack.length - 1;
  }

  get current() { return this.stack[this.index] || null; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }

  push(snap, sel = null) {
    if (this.current?.snap === snap) { if (sel) this.current.sel = sel; return false; }
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push({ snap, sel });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  /** Liefert den vorherigen Stand + die Cursorposition der rückgängig gemachten Änderung */
  undo() {
    if (!this.canUndo) return null;
    const undone = this.stack[this.index--];
    return { snap: this.current.snap, sel: undone.sel, fallbackSel: this.current.sel };
  }

  redo() {
    if (!this.canRedo) return null;
    const entry = this.stack[++this.index];
    return { snap: entry.snap, sel: entry.sel, fallbackSel: null };
  }
}
