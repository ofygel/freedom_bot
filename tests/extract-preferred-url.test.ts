import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractPreferredUrl } from '../src/lib/extractPreferredUrl';

describe('extractPreferredUrl', () => {
  it('extracts a link that follows descriptive text', () => {
    const query = 'Barfly https://example.com/places/barfly';
    const extracted = extractPreferredUrl(query);

    assert.equal(extracted, 'https://example.com/places/barfly');
  });

  it('prefers 2ГИС links when present in multiline descriptions', () => {
    const query = [
      'Barfly bar',
      'https://example.com/places/barfly',
      'https://2gis.kz/almaty/firm/70000001078895647',
    ].join('\n');

    const extracted = extractPreferredUrl(query);

    assert.equal(extracted, 'https://2gis.kz/almaty/firm/70000001078895647');
  });

  it('removes trailing punctuation from extracted links', () => {
    const query = 'More info: https://2gis.kz/almaty/firm/70000001078895647).';

    const extracted = extractPreferredUrl(query);

    assert.equal(extracted, 'https://2gis.kz/almaty/firm/70000001078895647');
  });
});
