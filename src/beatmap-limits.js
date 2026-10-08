export function validNoteData(p) {
  const count = p.noteStarts.length;
  return count > 0 && count <= 50000
    && [p.noteEnds, p.columns, p.noteTypes].every(a => a.length === count)
    && p.noteStarts.every((start, i) => Number.isFinite(start) && start >= 0 && start <= 7200000
      && Number.isFinite(p.noteEnds[i]) && p.noteEnds[i] >= start && p.noteEnds[i] <= 7200000
      && Number.isInteger(p.columns[i]) && p.columns[i] >= 0 && p.columns[i] < p.columnCount
      && Number.isInteger(p.noteTypes[i]));
}
