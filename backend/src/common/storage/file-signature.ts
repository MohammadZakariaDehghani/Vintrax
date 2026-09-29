/**
 * Whether a file's first bytes match the content type it was uploaded as.
 *
 * The declared type comes from the client's multipart header, which is
 * whatever the client chose to write. The stored extension, and so the type
 * the file is later served with, is derived from it — so checking the bytes is
 * what stops an HTML page, a script or an executable being stored under a
 * `.png` name and handed out from Vintrax's own origin.
 *
 * Only the types StorageService accepts are known here; anything else is
 * refused.
 */
export function matchesSignature(buffer: Buffer, contentType: string): boolean {
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('latin1');

  switch (contentType) {
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case 'image/webp':
      return buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/avif':
      return (
        buffer.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))
      );
    case 'video/mp4':
      // An ISO base media file opens with its `ftyp` box.
      return buffer.length >= 12 && ascii(4, 8) === 'ftyp';
    case 'application/pdf':
      // The header must appear in the first 1024 bytes; in practice it opens the file.
      return buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');
    default:
      return false;
  }
}
