import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/* ══════════════════════════════════════════════════════════════════
   A PASSWORD-PROTECTED ZIP, WRITTEN AND READ HERE (D27-209, D27-211)

   A guest's ID photos leave this server only as one of these: a zip whose
   every file is encrypted with AES-256, in the format WinZip published and
   7-Zip opens ("AE-2"). The owner's requirement decides the format: a
   bundle must open on a Windows PC with a common tool and the hotel's
   password, with nothing of ours installed.

   Nothing installed writes or reads this format (archiver, jszip and
   unzipper cannot encrypt or decrypt), and the master ruled out a new
   dependency - so it is written here, over node:crypto and node:zlib, and
   proved three ways (api/test/aesZip.test.ts): a round trip; against an
   independent tool both ways (libarchive's bsdtar opens what this writes,
   and this decrypts what bsdtar wrote); and the owner opening one in 7-Zip
   before the upload is ever switched on.

   PER FILE, as the format fixes it:
     keys        PBKDF2-HMAC-SHA1(password, a fresh 16-byte salt, 1,000
                 rounds) → 32 bytes to encrypt, 32 to authenticate, 2 to
                 tell a wrong password early
     encryption  AES-256, counter mode, a little-endian counter from 1
     proof       HMAC-SHA1 over the ciphertext, its first 10 bytes -
                 checked BEFORE anything is decrypted
     layout      salt · 2 check bytes · ciphertext · 10 proof bytes

   ⚠ 1,000 ROUNDS IS THE FORMAT'S, AND IT IS FEW. It is no defence for a
   short password, which is why a hotel's password under 20 characters
   counts as not set (idPhotos.ts). With 24 random letters and digits the
   rounds do not matter.

   WHAT IS NOT HIDDEN: a zip's list of names and sizes is outside the
   encryption. Callers name files front.jpg, back.jpg, about.txt - nothing
   of the guest - and the facts go INSIDE about.txt.

   READING IS STRICT: only what `seal` writes is opened. Anything else -
   another method, another strength, an extra field, a size that does not
   add up - is refused whole, and nothing is returned.
   ══════════════════════════════════════════════════════════════════ */

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

export interface Entry { name: string; bytes: Buffer }

const SALT = 16;
const CHECK = 2;
const PROOF = 10;
const KEY = 32;
const ROUNDS = 1000;
/** No bundle holds more, and no file in one is larger: a bound on what a
    file claiming to be a bundle can make this process allocate. */
const MAX_ENTRIES = 8;
const MAX_FILE = 16 * 1024 * 1024;

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Encrypted (bit 0), names in UTF-8 (bit 11). */
const FLAGS = 0x0801;
const AES_METHOD = 99;
/** The AES extra field: id 0x9901, 7 bytes; AE-2; vendor "AE"; strength 3
    (256 bits); the real compression underneath, 8 (deflate). */
const AES_EXTRA = Buffer.from([0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, 0x08, 0x00]);

function keysFor(password: string, salt: Buffer) {
  const k = pbkdf2Sync(Buffer.from(password, "utf8"), salt, ROUNDS, 2 * KEY + CHECK, "sha1");
  return { encrypt: k.subarray(0, KEY), prove: k.subarray(KEY, 2 * KEY), check: k.subarray(2 * KEY) };
}

/** AES-256 in counter mode as the format counts: a 16-byte LITTLE-endian
    counter starting at 1. Node's own CTR counts big-endian, so the key
    stream is made here, one AES block per counter. The same call encrypts
    and decrypts. */
function counterMode(key: Buffer, data: Buffer): Buffer {
  const blocks = Math.ceil(data.length / 16);
  const counters = Buffer.alloc(blocks * 16);
  for (let i = 0; i < blocks; i += 1) counters.writeUInt32LE(i + 1, i * 16);
  const aes = createCipheriv("aes-256-ecb", key, null).setAutoPadding(false);
  const stream = Buffer.concat([aes.update(counters), aes.final()]);
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i]! ^ stream[i]!;
  return out;
}

const proofOf = (key: Buffer, ciphertext: Buffer) =>
  createHmac("sha1", key).update(ciphertext).digest().subarray(0, PROOF);

/** One file's encrypted form: salt · check · ciphertext · proof. */
export function encrypt(data: Buffer, password: string, salt: Buffer = randomBytes(SALT)): Buffer {
  const keys = keysFor(password, salt);
  const ciphertext = counterMode(keys.encrypt, data);
  return Buffer.concat([salt, keys.check, ciphertext, proofOf(keys.prove, ciphertext)]);
}

/** Its plain form again - or a BundleError, and nothing else, when the
    password is wrong or a single byte has changed. Both comparisons are
    constant-time, and both are made before either is acted on. */
export function decrypt(payload: Buffer, password: string): Buffer {
  if (payload.length < SALT + CHECK + PROOF) throw new BundleError("Too short to be an encrypted file.");
  const keys = keysFor(password, payload.subarray(0, SALT));
  const ciphertext = payload.subarray(SALT + CHECK, payload.length - PROOF);
  const rightPassword = timingSafeEqual(keys.check, payload.subarray(SALT, SALT + CHECK));
  const untouched = timingSafeEqual(proofOf(keys.prove, ciphertext), payload.subarray(payload.length - PROOF));
  if (!rightPassword || !untouched) {
    throw new BundleError("The password is wrong, or the file has been changed.");
  }
  return counterMode(keys.encrypt, ciphertext);
}

/** A zip's two-second clock, in UTC. */
function dosClock(at: Date): [time: number, date: number] {
  return [
    (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  ];
}

/** The files as one encrypted zip. `salt` is for the known-answer test
    alone: every real file gets fresh random bytes. */
export function seal(
  entries: readonly Entry[], password: string, at: Date = new Date(),
  salt: () => Buffer = () => randomBytes(SALT),
): Buffer {
  if (entries.length < 1 || entries.length > MAX_ENTRIES) throw new BundleError("A bundle holds one to eight files.");
  const [time, date] = dosClock(at);
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(entry.name)) throw new BundleError("A file's name is letters, digits, dot, dash.");
    if (entry.bytes.length > MAX_FILE) throw new BundleError("A file is too large for a bundle.");
    const name = Buffer.from(entry.name, "utf8");
    const payload = encrypt(deflateRawSync(entry.bytes), password, salt());

    /* Local header. The CRC is zero: in AE-2 the proof bytes replace it. */
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(51, 4);                    // version needed: AES
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(AES_METHOD, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(AES_EXTRA.length, 28);

    /* The directory's copy: the same 26 bytes, then where the file is. */
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(51, 4);                  // version made by
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);

    files.push(local, name, AES_EXTRA, payload);
    directory.push(central, name, AES_EXTRA);
    offset += 30 + name.length + AES_EXTRA.length + payload.length;
  }

  const listed = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listed.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, listed, end]);
}

/** The files of a bundle `seal` made - all of them, or a BundleError. */
export function open(zip: Buffer, password: string): Entry[] {
  const not = () => new BundleError("This is not a bundle this system made.");
  const end = zip.length - 22;
  if (end < 0 || zip.readUInt32LE(end) !== END) throw not();
  const count = zip.readUInt16LE(end + 10);
  const listedAt = zip.readUInt32LE(end + 16);
  if (count < 1 || count > MAX_ENTRIES || zip.readUInt16LE(end + 8) !== count
    || listedAt + zip.readUInt32LE(end + 12) !== end) throw not();

  const entries: Entry[] = [];
  let at = listedAt;
  let expected = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL) throw not();
    const nameLength = zip.readUInt16LE(at + 28);
    const stored = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const offset = zip.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + AES_EXTRA.length;
    if (zip.readUInt16LE(at + 8) !== FLAGS || zip.readUInt16LE(at + 10) !== AES_METHOD
      || zip.readUInt16LE(at + 30) !== AES_EXTRA.length || zip.readUInt16LE(at + 32) !== 0
      || next > end || size > MAX_FILE || offset !== expected
      || !zip.subarray(next - AES_EXTRA.length, next).equals(AES_EXTRA)) throw not();
    const name = zip.subarray(at + 46, at + 46 + nameLength);

    /* The file itself must say what the directory says, byte for byte. */
    const head = offset + 30 + nameLength + AES_EXTRA.length;
    if (head + stored > listedAt || zip.readUInt32LE(offset) !== LOCAL
      || !zip.subarray(offset + 4, offset + 30).equals(zip.subarray(at + 6, at + 32))
      || !zip.subarray(offset + 30, head).equals(Buffer.concat([name, AES_EXTRA]))) throw not();

    let bytes: Buffer;
    try {
      bytes = inflateRawSync(decrypt(zip.subarray(head, head + stored), password), { maxOutputLength: Math.max(size, 1) });
    } catch (error) {
      if (error instanceof BundleError) throw error;
      throw not();
    }
    if (bytes.length !== size) throw not();
    entries.push({ name: name.toString("utf8"), bytes });
    expected = head + stored;
    at = next;
  }
  if (at !== end || expected !== listedAt) throw not();
  return entries;
}
