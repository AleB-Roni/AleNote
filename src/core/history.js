// Rückgängig / Wiederholen pro Notiz (Schnappschüsse des Notizinhalts)

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.reset(null);
  }

  reset(snapshot) {
    this.stack = snapshot ? [snapshot] : [];
    this.index = this.stack.length - 1;
  }

  push(snapshot) {
    if (this.stack[this.index] === snapshot) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  undo() { return this.index > 0 ? this.stack[--this.index] : null; }
  redo() { return this.index < this.stack.length - 1 ? this.stack[++this.index] : null; }
}
