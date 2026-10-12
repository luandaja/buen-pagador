import { describe, expect, it } from 'vitest';
import { importKey, newKey } from '../../src/scripts/crypto';
import { decryptFields, diff, encryptFields, fromPlain, isEmptyDiff, merge, toPlain } from '../../src/scripts/group/codec';
import { addPerson, GROUP_SCHEMA_VERSION, newGroup, saveExpense } from '../../src/scripts/group/model';

function sample() {
  let group = newGroup({ title: 'Cusco', emoji: '✈️', currency: '$' });
  group = addPerson(addPerson(group, 'Ana'), 'Beto');
  const [ana, beto] = group.people;
  group = { ...group, people: [{ ...ana, at: 1 }, { ...beto, at: 2 }] };
  return saveExpense(group, { id: 'e1', what: 'Hotel', amount: 100, by: ana.id, at: 5 });
}

describe('plain fields', () => {
  it('round-trips a group through one field per item, ordered by creation', () => {
    const group = sample();
    const plain = toPlain(group);
    expect(Object.keys(plain).sort()).toEqual(['e:e1', 'm', ...group.people.map((person) => `p:${person.id}`)].sort());
    expect(JSON.parse(plain.m)).toEqual({ schemaVersion: GROUP_SCHEMA_VERSION, title: 'Cusco', emoji: '✈️', currency: '$', palette: 'cancha' });

    const reversed = Object.fromEntries(Object.entries(plain).reverse());
    const restored = fromPlain(reversed, newGroup());
    expect(restored.people.map((person) => person.name)).toEqual(['Ana', 'Beto']);
    expect(restored).toMatchObject({ title: 'Cusco', emoji: '✈️', currency: '$', expenses: [{ id: 'e1', what: 'Hotel' }] });
  });

  it('falls back to defaults without meta and orders items without timestamps by id', () => {
    const base = newGroup({ title: 'Local' });
    const restored = fromPlain({ 'p:b': JSON.stringify({ id: 'b', name: 'B' }), 'p:a': JSON.stringify({ id: 'a', name: 'A' }) }, base);
    expect(restored).toMatchObject({ title: 'Local', emoji: '🧾', palette: 'cancha' });
    expect(restored.people.map((person) => person.id)).toEqual(['a', 'b']);
  });
});

describe('diff and merge', () => {
  it('finds set and deleted fields', () => {
    expect(diff({ m: '1', 'p:a': 'x' }, { m: '2', 'e:b': 'y' })).toEqual({ set: { m: '2', 'e:b': 'y' }, del: ['p:a'] });
    expect(isEmptyDiff(diff({ m: '1' }, { m: '1' }))).toBe(true);
  });

  it('keeps local edits and takes everything else from the server', () => {
    const base = { m: 'title', 'p:a': 'ana', 'e:old': 'old' };
    const local = { m: 'title', 'p:a': 'ana paid', 'e:mine': 'mine' };
    const remote = { m: 'new title', 'p:a': 'ana', 'e:old': 'old', 'e:theirs': 'theirs' };
    expect(merge(base, local, remote)).toEqual({ m: 'new title', 'p:a': 'ana paid', 'e:mine': 'mine', 'e:theirs': 'theirs' });
  });
});

describe('field encryption', () => {
  it('encrypts each field and skips fields it cannot decrypt', async () => {
    const { raw } = await newKey();
    const key = await importKey(raw);
    const plain = toPlain(sample());
    const encrypted = await encryptFields(key, plain);
    expect(encrypted.m).not.toContain('Cusco');
    const other = await importKey((await newKey()).raw);
    const decrypted = await decryptFields(key, { ...encrypted, 'e:bad': (await encryptFields(other, { x: '1' })).x });
    expect(decrypted).toEqual(plain);
  });
});
