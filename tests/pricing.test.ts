import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calcPrice } from '../src/utils/pricing';
import { updateSetting } from '../src/services/settings';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  return { dir, prev };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('option surcharges are added to price', async () => {
  const { dir, prev } = setup();
  try {
    await updateSetting('surcharge_thermobox', 100);
    await updateSetting('surcharge_change', 50);
    const { price, nightApplied } = await calcPrice(
      1,
      'M',
      new Date('2024-01-01T12:00:00Z'),
      'other',
      ['Термобокс', 'Нужна сдача']
    );
    assert.equal(price, 830);
    assert.equal(nightApplied, false);
  } finally {
    teardown(dir, prev);
  }
});

test('night coefficient is applied when active', async () => {
  const { dir, prev } = setup();
  try {
    await updateSetting('night_active', true);
    const { price, nightApplied } = await calcPrice(
      1,
      'M',
      new Date('2024-01-01T23:00:00Z'),
      'other',
      []
    );
    assert.equal(price, 720);
    assert.equal(nightApplied, true);
  } finally {
    teardown(dir, prev);
  }
});

test('waiting over free limit adds to price', async () => {
  const { dir, prev } = setup();
  try {
    await updateSetting('wait_free', 5);
    await updateSetting('wait_per_min', 20);
    const { price, nightApplied } = await calcPrice(
      1,
      'M',
      new Date('2024-01-01T12:00:00Z'),
      'other',
      [],
      10
    );
    assert.equal(price, 780);
    assert.equal(nightApplied, false);
  } finally {
    teardown(dir, prev);
  }
});
