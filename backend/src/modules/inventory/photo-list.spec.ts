import { splitPhotoList } from '@vintrax/shared';

/**
 * Feeds list a vehicle's extra photos in one cell, and not every feed uses our
 * ";". Read as a single address, a "|" or "," list failed to download whole and
 * the vehicle got none of its extra photos.
 */
describe('a cell listing several photos', () => {
  const two = ['https://photos.example.ca/1.jpg', 'https://photos.example.ca/2.jpg'];

  it.each([
    ['semicolons', 'https://photos.example.ca/1.jpg;https://photos.example.ca/2.jpg'],
    ['pipes', 'https://photos.example.ca/1.jpg|https://photos.example.ca/2.jpg'],
    ['commas', 'https://photos.example.ca/1.jpg, https://photos.example.ca/2.jpg'],
    ['spaces', 'https://photos.example.ca/1.jpg https://photos.example.ca/2.jpg'],
    ['line breaks', 'https://photos.example.ca/1.jpg\nhttps://photos.example.ca/2.jpg'],
  ])('is split on %s', (_label, cell) => {
    expect(splitPhotoList(cell)).toEqual(two);
  });

  it('leaves a comma inside an address alone', () => {
    expect(
      splitPhotoList('https://cdn.example.ca/w_300,h_200/1.jpg,https://cdn.example.ca/2.jpg'),
    ).toEqual(['https://cdn.example.ca/w_300,h_200/1.jpg', 'https://cdn.example.ca/2.jpg']);
  });

  it('splits the matching list of dates on the same separators', () => {
    expect(splitPhotoList('03/04/2026 10:00:00;03/05/2026 11:00:00')).toHaveLength(2);
    expect(splitPhotoList('03/04/2026 10:00:00|03/05/2026 11:00:00')).toHaveLength(2);
    expect(splitPhotoList('03/04/2026 10:00:00')).toEqual(['03/04/2026 10:00:00']);
  });
});
