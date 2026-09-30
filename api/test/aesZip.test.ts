import { describe, it, expect } from "vitest";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { BundleError, decrypt, encrypt, open, seal } from "../src/aesZip.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ENCRYPTED ZIP (D27-209, D27-211) - format code written by hand
   around identity documents, so it is proved three ways:

     1  a round trip, and every way it must FAIL CLOSED
     2  against an independent tool, both ways: libarchive's bsdtar
        (Windows' own tar.exe) wrote the fixture this file decrypts, and
        where that tar exists it opens what `seal` writes; and one whole
        bundle with fixed salts, pinned byte for byte
     3  the owner opening one in 7-Zip, before the upload is switched on -
        a release step (deploy/n8n/IMPORT.md), not a test

   Every password, name and byte here is made up.
   ══════════════════════════════════════════════════════════════════ */

const PASSWORD = "MadeUpPassword0123456789";
/* The sha256 of the fixed bundle below. It moves if a header byte moves -
   and if a Node upgrade ever changes deflate's own bytes: then check the
   bsdtar test still opens it, and record the new one. */
const PINNED = "059d1fb11f4c1474ae59e394c336bb91c2267e582ac70c163df191afb3d496f9";
const photo = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
const ENTRIES = [
  { name: "about.txt", bytes: Buffer.from("A made-up bundle.\nHotel: TEST\n") },
  { name: "front.jpg", bytes: photo },
];
const same = (a: { name: string; bytes: Buffer }[], b: typeof a) =>
  a.length === b.length && a.every((e, i) => e.name === b[i]!.name && e.bytes.equals(b[i]!.bytes));
const refused = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error; }
  return "it opened";
};

describe("the encrypted zip: a round trip", () => {
  it("gives back every file, byte for byte, with the password", () => {
    expect(same(open(seal(ENTRIES, PASSWORD), PASSWORD), ENTRIES)).toBe(true);
    const big = [{ name: "front.jpg", bytes: randomBytes(3 * 1024 * 1024 + 7) }];
    expect(same(open(seal(big, PASSWORD), PASSWORD), big)).toBe(true);
    const empty = [{ name: "about.txt", bytes: Buffer.alloc(0) }];
    expect(same(open(seal(empty, PASSWORD), PASSWORD), empty)).toBe(true);
  });

  it("holds none of the plain bytes, and no two are alike", () => {
    const words = Buffer.from("A guest's made-up name, which must not be readable. ".repeat(20));
    const noise = randomBytes(4096);
    const a = seal([{ name: "about.txt", bytes: words }, { name: "front.jpg", bytes: noise }], PASSWORD);
    expect(a.includes(words.subarray(0, 24))).toBe(false);
    expect(a.includes(noise.subarray(100, 132))).toBe(false);
    /* A fresh salt for every file, so the same photo twice is two different files. */
    const b = seal([{ name: "about.txt", bytes: words }, { name: "front.jpg", bytes: noise }], PASSWORD);
    expect(a.equals(b)).toBe(false);
  });
});

describe("the encrypted zip: it fails closed", () => {
  const zip = seal(ENTRIES, PASSWORD);

  it("refuses a wrong password, and gives nothing back", () => {
    expect(refused(() => open(zip, "WrongPassword01234567890"))).toBeInstanceOf(BundleError);
    expect(refused(() => open(zip, ""))).toBeInstanceOf(BundleError);
    expect(refused(() => open(zip, PASSWORD.toLowerCase()))).toBeInstanceOf(BundleError);
  });

  it("refuses a bundle with any one byte changed", () => {
    /* Every byte in turn would be slow; every 7th covers the headers, the
       salt, the check bytes, the ciphertext, the proof and the directory. */
    for (let i = 0; i < zip.length; i += 7) {
      const changed = Buffer.from(zip);
      changed[i] = changed[i]! ^ 0x01;
      const out = refused(() => open(changed, PASSWORD));
      /* A changed TIME in a header changes no file: the one thing that may
         still open, and only to the same bytes. */
      if (out === "it opened") expect(same(open(changed, PASSWORD), ENTRIES), `byte ${i}`).toBe(true);
      else expect(out, `byte ${i}`).toBeInstanceOf(BundleError);
    }
    const inTheCiphertext = Buffer.from(zip);
    const where = 30 + 9 + 11 + 16 + 2 + 5;
    inTheCiphertext[where] = inTheCiphertext[where]! ^ 0x80;
    expect(refused(() => open(inTheCiphertext, PASSWORD))).toBeInstanceOf(BundleError);
  });

  it("refuses a shortened file, a lengthened one, and one that is not a bundle", () => {
    expect(refused(() => open(zip.subarray(0, zip.length - 1), PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => open(zip.subarray(0, 40), PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => open(Buffer.concat([zip, Buffer.from([0])]), PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => open(Buffer.alloc(0), PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => open(Buffer.from("not a zip at all, only some words"), PASSWORD))).toBeInstanceOf(BundleError);
  });

  it("refuses a bundle stitched together from two", () => {
    /* The head of one bundle on the body of another: the directory no
       longer says what the files say. */
    const other = seal([{ name: "about.txt", bytes: Buffer.from("x") }, ENTRIES[1]!], PASSWORD);
    const spliced = Buffer.concat([other.subarray(0, 60), zip.subarray(60)]);
    expect(refused(() => open(spliced, PASSWORD))).toBeInstanceOf(BundleError);
  });

  it("writes only plain file names, one to eight files", () => {
    expect(refused(() => seal([], PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => seal([{ name: "../front.jpg", bytes: photo }], PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => seal([{ name: "a guest's name.jpg", bytes: photo }], PASSWORD))).toBeInstanceOf(BundleError);
    expect(refused(() => seal(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.jpg`, bytes: photo })), PASSWORD)))
      .toBeInstanceOf(BundleError);
  });
});

describe("the encrypted zip: against an independent tool", () => {
  /* Made on 30 September 2026 by Windows' tar.exe (bsdtar 3.8.8, libarchive
     3.8.8, its own AES through Windows' crypto):
       tar -c -f enc.zip --format zip --options zip:encryption=aes256
           --passphrase MadeUpPassword0123456789 about.txt
     about.txt held the 26 bytes below. */
  const BSDTAR = Buffer.from(
    "UEsDBBQACQBjAICEPl0AAAAAAAAAAAAAAAAJACsAYWJvdXQudHh0dXgLAAEEAAAAAAQAAAAAAZkHAAEAQUUDCABVVA0A"
    + "BxjtvGoY7bxqGO28ahRPQyGi4Y6pJ7FFEWNWpDGWR7y8FGY76QScVtEcW9M1cbN38h+OECS4s/JUnhqnSsF+/bsBtD9d"
    + "UEsHCO64dMc4AAAAGgAAAFBLAQIUAxQACQBjAICEPl3uuHTHOAAAABoAAAAJACMAAAAAAAAAAAC2gQAAAABhYm91dC50"
    + "eHR1eAsAAQQAAAAABAAAAAABmQcAAQBBRQMIAFVUBQABGO28alBLBQYAAAAAAQABAFoAAACaAAAAAAA=", "base64");
  const THEIR_WORDS = "hello from a made-up file\n";

  /** bsdtar's one file: where its encrypted bytes are, from its directory. */
  const theirPayload = () => {
    const directory = BSDTAR.readUInt32LE(BSDTAR.length - 22 + 16);
    const stored = BSDTAR.readUInt32LE(directory + 20);
    const start = 30 + BSDTAR.readUInt16LE(26) + BSDTAR.readUInt16LE(28);
    return BSDTAR.subarray(start, start + stored);
  };

  it("decrypts a file bsdtar encrypted: the keys, the counter and the proof are the format's", () => {
    expect(inflateRawSync(decrypt(theirPayload(), PASSWORD)).toString()).toBe(THEIR_WORDS);
    expect(refused(() => decrypt(theirPayload(), "WrongPassword01234567890"))).toBeInstanceOf(BundleError);
  });

  it("derives the keys as the format says: PBKDF2-HMAC-SHA1, 1,000 rounds, the file's own salt", () => {
    /* The two check bytes bsdtar stored are bytes 65 and 66 of the derived
       key: a known answer from its implementation, not from this one. */
    const payload = theirPayload();
    const derived = pbkdf2Sync(PASSWORD, payload.subarray(0, 16), 1000, 66, "sha1");
    expect(derived.subarray(64).equals(payload.subarray(16, 18))).toBe(true);
    /* And `encrypt` with that salt writes the same salt and check bytes. */
    const mine = encrypt(Buffer.from("anything"), PASSWORD, Buffer.from(payload.subarray(0, 16)));
    expect(mine.subarray(0, 18).equals(payload.subarray(0, 18))).toBe(true);
  });

  /* One whole small bundle, fixed salts and a fixed time, pinned. The hash
     was taken on 30 September 2026 from the bundle bsdtar then opened to
     the two files below; a change to a single header byte shows here. */
  it("writes one fixed bundle the same, byte for byte", () => {
    let n = 0;
    const zip = seal(ENTRIES, PASSWORD, new Date(Date.UTC(2026, 8, 30, 10, 20, 30)),
      () => Buffer.alloc(16, ++n));
    expect(createHash("sha256").update(zip).digest("hex")).toBe(PINNED);
    expect(same(open(zip, PASSWORD), ENTRIES)).toBe(true);
  });

  const TAR = "C:\\Windows\\System32\\tar.exe";
  it.skipIf(!existsSync(TAR))("is opened by bsdtar (Windows' own tar) to the same files, and not with a wrong password", () => {
    const dir = mkdtempSync(join(tmpdir(), "fidato-aeszip-"));
    try {
      let n = 0;
      writeFileSync(join(dir, "pinned.zip"), seal(ENTRIES, PASSWORD, new Date(Date.UTC(2026, 8, 30, 10, 20, 30)),
        () => Buffer.alloc(16, ++n)));
      writeFileSync(join(dir, "fresh.zip"), seal(ENTRIES, PASSWORD));
      for (const name of ["pinned.zip", "fresh.zip"]) {
        execFileSync(TAR, ["-x", "-f", name, "--passphrase", PASSWORD], { cwd: dir, stdio: "pipe" });
        for (const e of ENTRIES) {
          expect(readFileSync(join(dir, e.name)).equals(e.bytes), `${name}: ${e.name}`).toBe(true);
          rmSync(join(dir, e.name));
        }
      }
      let said = "";
      try {
        said = execFileSync(TAR, ["-x", "-f", "fresh.zip", "--passphrase", "WrongPassword01234567890"],
          { cwd: dir, stdio: "pipe" }).toString();
      } catch (error) {
        said = String((error as { stderr?: Buffer }).stderr ?? error);
      }
      const leaked = ENTRIES.some((e) => existsSync(join(dir, e.name)) && readFileSync(join(dir, e.name)).equals(e.bytes));
      expect(leaked, `a wrong password opened it: ${said}`).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
