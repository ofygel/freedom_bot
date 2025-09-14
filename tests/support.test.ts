import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTicket, getTicket } from '../src/services/tickets';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  return { dir, prev };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('create ticket with text', () => {
  const { dir, prev } = setup();
  try {
    const ticket = createTicket({
      order_id: 1,
      user_id: 1,
      topic: 'topic',
      text: 'hello',
    });
    assert.equal(ticket.text, 'hello');
    const saved = getTicket(ticket.id)!;
    assert.equal(saved.text, 'hello');
  } finally {
    teardown(dir, prev);
  }
});

test('create ticket with photo', () => {
  const { dir, prev } = setup();
  try {
    const ticket = createTicket({
      order_id: 1,
      user_id: 1,
      topic: 'topic',
      photo: 'file_id',
    });
    assert.equal(ticket.photo, 'file_id');
    const saved = getTicket(ticket.id)!;
    assert.equal(saved.photo, 'file_id');
  } finally {
    teardown(dir, prev);
  }
});
