/**
 * Every agent seat gets a stable name, derived from its id: the same seat is always the same
 * agent, on the site, in briefings and on the message board.
 */

const GIVEN = [
  'Ada', 'Bram', 'Cass', 'Dara', 'Elio', 'Fenn', 'Gaia', 'Hale', 'Ines', 'Juno', 'Kai', 'Lior',
  'Mira', 'Noor', 'Odin', 'Pell', 'Quill', 'Rhea', 'Sol', 'Tove', 'Uma', 'Vale', 'Wren', 'Xan',
  'Yara', 'Zev', 'Ansel', 'Brisa', 'Calder', 'Dune', 'Esme', 'Faro', 'Isla', 'Jory', 'Kestrel',
  'Lumen', 'Maren', 'Nilo', 'Orrin', 'Petra', 'Rune', 'Sable', 'Tamsin', 'Vesper', 'Wilder',
];

const FAMILY = [
  'Ashgrove', 'Blackwater', 'Coldharbor', 'Driftwood', 'Emberline', 'Fallowfield', 'Glasswing',
  'Hollowell', 'Ironside', 'Juniper', 'Kettlebeck', 'Larkspur', 'Moonfield', 'Northcote',
  'Oakhurst', 'Pinecrest', 'Quarrystone', 'Ravensmoor', 'Saltmarsh', 'Thornbury', 'Underhill',
  'Vantage', 'Wintermere', 'Yarrow', 'Zephyrine', 'Brightwater', 'Copperfield', 'Duskmere',
  'Foxglove', 'Greystone', 'Harrowgate', 'Kingsley', 'Lowmoor', 'Marrowby', 'Nettlefield',
];

/** FNV-1a: small, stable, good enough to spread seat ids over the name lists. */
export const hashSeed = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** "Vesper Glasswing" for a seat like "chess/search". Roles keep a fitting title. */
export const agentName = (seatOrId: string) => {
  const id = seatOrId.replace(/\//g, '-');
  if (id === 'strategist') return 'The Strategist';
  if (id === 'referee') return 'The Referee';
  const h = hashSeed(id);
  return `${GIVEN[h % GIVEN.length]} ${FAMILY[(h >>> 8) % FAMILY.length]}`;
};
