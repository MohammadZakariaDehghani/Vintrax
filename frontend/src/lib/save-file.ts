/** Hands the browser a file to save, from bytes already in memory. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Saves text as a UTF-8 CSV, with the byte-order mark Excel needs to read accents. */
export function saveCsv(text: string, filename: string) {
  saveBlob(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), filename);
}
