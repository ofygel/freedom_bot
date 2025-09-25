import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseRecipientPhone } from '../src/bot/flows/client/deliveryOrderFlow';

describe('deliveryOrderFlow phone normalisation', () => {
  it('normalises phone numbers by removing separators and keeping leading plus', () => {
    assert.equal(normaliseRecipientPhone('+7 700 123-45-67'), '+77001234567');
  });

  it('accepts domestic format without plus sign', () => {
    assert.equal(normaliseRecipientPhone('87001234567'), '+77001234567');
  });

  it('rejects numbers with insufficient digits', () => {
    assert.equal(normaliseRecipientPhone('1234567'), undefined);
  });

  it('rejects malformed inputs with extra symbols', () => {
    assert.equal(normaliseRecipientPhone('+7(700)12A345'), undefined);
    assert.equal(normaliseRecipientPhone('++77001234567'), undefined);
  });
});
