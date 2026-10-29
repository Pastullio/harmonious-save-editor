// Ported from hadsh/nms_namegen (MIT).
const ROMAN_NUMERALS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII',
  'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

function toRoman(numeral) {
  return ROMAN_NUMERALS[Math.trunc(numeral) - 1];
}

export { toRoman };
