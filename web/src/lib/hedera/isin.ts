/**
 * Direct port of isinValidator.sol's `_checkChecksum`
 * (hashgraph/asset-tokenization-studio, packages/ats/contracts).
 *
 * Letters map to ascii-55 (A=10..Z=35); two-digit codes split into separate
 * entries before summation, not before doubling; the doubling parity is
 * chosen from the total digit count rather than fixed to odd or even
 * position. A textbook ISIN checksum implementation does not reproduce this
 * — confirmed the hard way: the SDK's own passing integration test uses an
 * ISIN that reverts with a decoded WrongISINChecksum on the live contract,
 * and a first, textbook-correct attempt at this function produced a
 * different, still-wrong digit. See hedera/README.md for the real
 * transaction that confirmed the value this file's own test asserts.
 */

export function isinChecksum(base11: string): string {
  if (base11.length !== 11) throw new Error("ISIN base must be 11 characters.");

  const byteToCode = (ch: string): number => {
    const code = ch.charCodeAt(0);
    return code > 57 ? code - 55 : code - 48; // '9' is ascii 57
  };

  const conv: number[] = [];
  for (const ch of base11) {
    const code = byteToCode(ch);
    if (code > 9) conv.push(Math.floor(code / 10), code % 10);
    else conv.push(code);
  }

  const pairing = (conv.length + 1) % 2;
  let checksum = 0;
  conv.forEach((digit, index) => {
    const doubled = index % 2 === pairing ? digit * 2 : digit;
    checksum += doubled > 9 ? Math.floor(doubled / 10) + (doubled % 10) : doubled;
  });
  return String((10 - (checksum % 10)) % 10);
}

export function realIsin(base11: string): string {
  return base11 + isinChecksum(base11);
}
