import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_FOLDER } from '../../modules/media/media-library.service';
import { PRIVATE_UPLOAD_FOLDERS, PUBLIC_UPLOAD_FOLDERS } from './public-upload-folders';

/**
 * An upload route that writes to a folder the API does not serve returns a
 * URL that 404s for everyone. It has happened twice — make and partner logos,
 * then footer icons and the Contact map — each time invisible until someone
 * uploaded a file in a real deployment.
 */
describe('the folders upload routes write to', () => {
  const controller = readFileSync(
    join(__dirname, '../../modules/uploads/uploads.controller.ts'),
    'utf8',
  );
  const folders = [...controller.matchAll(/folder: '([^']+)'/g)].map((match) => match[1]!);

  it('finds the upload routes', () => {
    expect(folders.length).toBeGreaterThan(5);
  });

  it.each(folders)('%s is either served publicly or deliberately private', (folder) => {
    const known: readonly string[] = [...PUBLIC_UPLOAD_FOLDERS, ...PRIVATE_UPLOAD_FOLDERS];
    expect(known).toContain(folder);
  });

  it('serves the media library, whose files the home page shows', () => {
    expect(PUBLIC_UPLOAD_FOLDERS as readonly string[]).toContain(MEDIA_FOLDER);
  });

  it('never serves the private folders', () => {
    for (const folder of PRIVATE_UPLOAD_FOLDERS) {
      expect(PUBLIC_UPLOAD_FOLDERS as readonly string[]).not.toContain(folder);
    }
  });
});
