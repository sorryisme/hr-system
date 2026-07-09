import { patchBigIntJson } from './bigint-json';

describe('patchBigIntJson', () => {
  it('serializes BigInt as a string instead of throwing', () => {
    patchBigIntJson();

    expect(JSON.stringify({ id: 10n })).toBe('{"id":"10"}');
  });
});
