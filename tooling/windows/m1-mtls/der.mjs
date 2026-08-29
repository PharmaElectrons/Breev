/**
 * The smallest DER reader and writer that the Alpine peer needs.
 *
 * The peer machine gets one `scp` and no package installation, so the proof
 * client cannot use `@peculiar/asn1-*` the way `apps/local-api` and
 * `apps/desktop` do. Everything the harness has to encode (a PKCS#10 request,
 * a foreign certificate authority, a foreign device certificate) and everything
 * it has to decode (the certificate extensions that
 * `apps/desktop/src/main/pairing-trust.ts` inspects) is built here from
 * `node:buffer` alone.
 *
 * This file is deliberately not a general ASN.1 library. It handles definite
 * lengths, the handful of universal tags X.509 and PKCS#10 use, and nothing
 * else; anything unexpected throws rather than being interpreted.
 */

const MAX_LENGTH_BYTES = 4;

export const TAG = {
  bitString: 0x03,
  boolean: 0x01,
  generalizedTime: 0x18,
  ia5String: 0x16,
  integer: 0x02,
  null: 0x05,
  objectIdentifier: 0x06,
  octetString: 0x04,
  sequence: 0x30,
  set: 0x31,
  utcTime: 0x17,
  utf8String: 0x0c,
};

// ── Writing ──────────────────────────────────────────────────────────────────

export function derValue(tag, contents) {
  return Buffer.concat([
    Buffer.of(tag),
    encodeLength(contents.length),
    contents,
  ]);
}

export function derSequence(...parts) {
  return derValue(TAG.sequence, Buffer.concat(parts));
}

export function derSet(...parts) {
  return derValue(TAG.set, Buffer.concat(parts));
}

/** `[n]` constructed, the explicit tagging X.509 uses for version and extensions. */
export function derExplicit(number, contents) {
  return derValue(0xa0 | number, contents);
}

/** A context-specific constructed value (explicit, or an IMPLICIT SET body). */
export function derContext(number, contents) {
  return derExplicit(number, contents);
}

/** `[n]` primitive, the implicit tagging `GeneralName` uses for its URI member. */
export function derImplicitPrimitive(number, contents) {
  return derValue(0x80 | number, contents);
}

export function derBoolean(value) {
  return derValue(TAG.boolean, Buffer.of(value ? 0xff : 0x00));
}

export function derNull() {
  return derValue(TAG.null, Buffer.alloc(0));
}

/** A non-negative INTEGER, minimally encoded with the sign bit kept clear. */
export function derInteger(value) {
  let magnitude =
    typeof value === "number" ? numberToBytes(value) : Buffer.from(value);
  let start = 0;
  while (start + 1 < magnitude.length && magnitude[start] === 0x00) {
    start += 1;
  }
  magnitude = magnitude.subarray(start);
  if (magnitude.length === 0) {
    magnitude = Buffer.of(0x00);
  }
  const contents =
    (magnitude[0] & 0x80) === 0
      ? magnitude
      : Buffer.concat([Buffer.of(0x00), magnitude]);
  return derValue(TAG.integer, contents);
}

export function derOctetString(contents) {
  return derValue(TAG.octetString, contents);
}

export function derBitString(contents, unusedBits = 0) {
  return derValue(
    TAG.bitString,
    Buffer.concat([Buffer.of(unusedBits), contents]),
  );
}

export function derUtf8String(value) {
  return derValue(TAG.utf8String, Buffer.from(value, "utf8"));
}

export function derIa5String(value) {
  return derValue(TAG.ia5String, Buffer.from(value, "latin1"));
}

export function derObjectIdentifier(dotted) {
  const arcs = dotted.split(".").map((arc) => {
    const parsed = Number.parseInt(arc, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Not an object identifier: ${dotted}`);
    }
    return parsed;
  });
  if (arcs.length < 2) {
    throw new Error(`Not an object identifier: ${dotted}`);
  }
  const bytes = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    bytes.push(...base128(arc));
  }
  return derValue(TAG.objectIdentifier, Buffer.from(bytes));
}

/** The RSA signature AlgorithmIdentifier shape Breev's CSR and certs use. */
export function derAlgorithmIdentifier(oid) {
  return derSequence(derObjectIdentifier(oid), derNull());
}

/** An X.509 Name made from one UTF8String attribute per RDN, in order. */
export function derName(attributes) {
  return derSequence(
    ...attributes.map(({ oid, value }) =>
      derSet(derSequence(derObjectIdentifier(oid), derUtf8String(value))),
    ),
  );
}

/**
 * RFC 5280 §4.1.2.5: `UTCTime` through 2049, `GeneralizedTime` from 2050. The
 * pharmacy CA's own certificates follow the same rule through
 * `@peculiar/asn1-x509`, so a certificate minted here is shaped like one minted
 * by `apps/local-api/src/pharmacy-ca/pharmacy-ca-crypto.ts`.
 */
export function derTime(date) {
  const year = date.getUTCFullYear();
  const parts = [
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
  if (year >= 1950 && year <= 2049) {
    return derValue(
      TAG.utcTime,
      Buffer.from(`${pad(year % 100)}${parts}Z`, "latin1"),
    );
  }
  return derValue(
    TAG.generalizedTime,
    Buffer.from(`${String(year).padStart(4, "0")}${parts}Z`, "latin1"),
  );
}

/** Kept as the certificate builder's semantic spelling. */
export function derUtcTime(date) {
  return derTime(date);
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** One tag-length-value at `offset`, with the offset just past it. */
export function readTlv(buffer, offset = 0) {
  if (offset + 2 > buffer.length) {
    throw new Error("A DER value is truncated");
  }
  const tag = buffer[offset];
  const first = buffer[offset + 1];
  let contentStart = offset + 2;
  let length;
  if (first < 0x80) {
    length = first;
  } else {
    const count = first & 0x7f;
    if (count === 0 || count > MAX_LENGTH_BYTES) {
      throw new Error("A DER length is indefinite or unreasonably large");
    }
    if (contentStart + count > buffer.length) {
      throw new Error("A DER length is truncated");
    }
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + buffer[contentStart + index];
    }
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > buffer.length) {
    throw new Error("A DER value runs past the end of its buffer");
  }
  return { content: buffer.subarray(contentStart, end), end, tag };
}

/** Every child of a constructed value, in order. */
export function readChildren(content) {
  const children = [];
  let offset = 0;
  while (offset < content.length) {
    const item = readTlv(content, offset);
    children.push(item);
    offset = item.end;
  }
  return children;
}

export function readObjectIdentifier(content) {
  if (content.length === 0) {
    throw new Error("An object identifier is empty");
  }
  const arcs = [Math.floor(content[0] / 40), content[0] % 40];
  let value = 0;
  for (const byte of content.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join(".");
}

/**
 * A `KeyUsage` BIT STRING as the flag word `@peculiar/asn1-x509` reports, so a
 * comparison here means the same thing as `usage.toNumber()` does in
 * `apps/desktop/src/main/pairing-trust.ts`: bit *n* of the string is `1 << n`.
 */
export function readKeyUsageFlags(content) {
  if (content.length === 0) {
    throw new Error("A key usage bit string is empty");
  }
  const unused = content[0];
  const bits = content.subarray(1);
  let flags = 0;
  for (let index = 0; index < bits.length * 8 - unused; index += 1) {
    const byte = bits[index >> 3];
    if ((byte & (0x80 >> (index % 8))) !== 0) {
      flags |= 1 << index;
    }
  }
  return flags;
}

export function keyUsageBitString(flags) {
  let highest = -1;
  for (let index = 0; index < 16; index += 1) {
    if ((flags & (1 << index)) !== 0) {
      highest = index;
    }
  }
  if (highest === -1) {
    return derBitString(Buffer.alloc(0), 0);
  }
  const bytes = Buffer.alloc((highest >> 3) + 1);
  for (let index = 0; index <= highest; index += 1) {
    if ((flags & (1 << index)) !== 0) {
      bytes[index >> 3] |= 0x80 >> (index % 8);
    }
  }
  return derBitString(bytes, bytes.length * 8 - (highest + 1));
}

export function pemEncode(label, der) {
  const lines = der.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function toPem(label, der) {
  return pemEncode(label, der);
}

export function pemDecode(pem) {
  const body = pem.replace(/-----[^-]+-----/gu, "").replace(/\s/gu, "");
  const der = Buffer.from(body, "base64");
  if (der.length === 0 || der.toString("base64") !== body) {
    throw new Error("A PEM block does not decode to DER");
  }
  return der;
}

function encodeLength(length) {
  if (length < 0x80) {
    return Buffer.of(length);
  }
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  if (bytes.length > MAX_LENGTH_BYTES) {
    throw new Error("A DER value is unreasonably large");
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function numberToBytes(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Only non-negative integers are encoded here");
  }
  if (value === 0) {
    return Buffer.of(0x00);
  }
  const bytes = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from(bytes);
}

function base128(value) {
  const bytes = [value & 0x7f];
  let remaining = Math.floor(value / 128);
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  return bytes;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
