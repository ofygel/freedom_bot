import test from 'node:test';
import assert from 'node:assert/strict';
import { parse2GisLink } from '../src/utils/twoGis';

(test('parse single 2GIS link', async () => {
  const res = await parse2GisLink('https://2gis.kz/almaty?m=76.95,43.25');
  assert.deepEqual(res, { point: { lon: 76.95, lat: 43.25 } });
}));

(test('parse route 2GIS link', async () => {
  const res = await parse2GisLink(
    'https://2gis.kz/almaty/routeSearch/points/76.94,43.24;76.95,43.25'
  );
  assert.deepEqual(res, {
    from: { lon: 76.94, lat: 43.24 },
    to: { lon: 76.95, lat: 43.25 },
  });
}));
