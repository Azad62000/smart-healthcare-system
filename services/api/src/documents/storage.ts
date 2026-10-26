import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { ApiRequestError } from "../request-error.js";
import { documentAdditionalData, MedicalDataCrypto } from "../medical-data-crypto.js";
import type { DocumentMediaType } from "./types.js";

const extensionTypes: Record<string, DocumentMediaType> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};
const mediaExtensions: Record<DocumentMediaType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

export type DocumentStorageFormat = "aes-256-gcm-v1" | "legacy-plaintext";

export interface SavedDocument {
  storageKey: string;
  filename: string;
  mediaType: DocumentMediaType;
  byteSize: number;
  storageFormat: "aes-256-gcm-v1";
}

export class PrivateDocumentStorage {
  private readonly directory: string;

  constructor(directory: string, private readonly maxBytes: number, private readonly crypto: MedicalDataCrypto) {
    this.directory = resolve(directory);
  }

  async save(request: Request, filenameHeader: string | undefined): Promise<SavedDocument> {
    let filename: string | undefined;
    try { filename = filenameHeader ? decodeURIComponent(filenameHeader).trim() : undefined; }
    catch { throw new ApiRequestError(400, "INVALID_DOCUMENT_NAME", "Provide a supported filename without a path."); }
    if (!filename || filename.length > 255 || basename(filename) !== filename ||
        /[\\/\u0000-\u001f\u007f]/.test(filename)) {
      throw new ApiRequestError(400, "INVALID_DOCUMENT_NAME", "Provide a supported filename without a path.");
    }
    const expectedType = extensionTypes[extname(filename).toLowerCase()];
    const claimedType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (!expectedType || claimedType !== expectedType) {
      throw new ApiRequestError(415, "UNSUPPORTED_DOCUMENT_TYPE", "Only matching PDF, JPEG, and PNG files are accepted.");
    }

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const storageKey = randomUUID();
    const temporaryPath = resolve(this.directory, `${storageKey}.enc.uploading`);
    const finalPath = resolve(this.directory, `${storageKey}.enc`);
    let byteSize = 0;
    let signature = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    async function collectChunks(maxBytes: number) {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteSize += buffer.length;
        if (byteSize > maxBytes) throw new ApiRequestError(413, "DOCUMENT_TOO_LARGE", "The document exceeds the configured upload limit.");
        if (signature.length < 8) signature = Buffer.concat([signature, buffer.subarray(0, 8 - signature.length)]);
        chunks.push(buffer);
      }
    }

    try {
      await collectChunks(this.maxBytes);
      if (byteSize === 0 || !this.matchesSignature(signature, expectedType)) {
        throw new ApiRequestError(415, "INVALID_DOCUMENT_CONTENT", "The file contents do not match the selected document type.");
      }
      const encrypted = this.crypto.encryptBytes(
        Buffer.concat(chunks, byteSize),
        documentAdditionalData(storageKey, expectedType)
      );
      await pipeline(Readable.from([encrypted]), createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
      await renamePrivateFile(temporaryPath, finalPath);
      return { storageKey, filename, mediaType: expectedType, byteSize, storageFormat: "aes-256-gcm-v1" };
    } catch (error) {
      await rm(temporaryPath, { force: true });
      await rm(finalPath, { force: true });
      throw error;
    }
  }

  async open(
    storageKey: string,
    mediaType: DocumentMediaType,
    storageFormat: DocumentStorageFormat
  ): Promise<Readable> {
    this.assertStorageKey(storageKey);
    const plaintext = storageFormat === "aes-256-gcm-v1"
      ? this.crypto.decryptBytes(
        await readFile(resolve(this.directory, `${storageKey}.enc`)),
        documentAdditionalData(storageKey, mediaType)
      )
      : await readFile(resolve(this.directory, `${storageKey}${mediaExtensions[mediaType]}`));
    if (!this.matchesSignature(plaintext.subarray(0, 8), mediaType)) {
      throw new Error("Stored medical document failed integrity validation.");
    }
    return Readable.from([plaintext]);
  }

  async remove(storageKey: string, mediaType: DocumentMediaType): Promise<void> {
    this.assertStorageKey(storageKey);
    await Promise.all([
      rm(resolve(this.directory, `${storageKey}.enc`), { force: true }),
      rm(resolve(this.directory, `${storageKey}${mediaExtensions[mediaType]}`), { force: true })
    ]);
  }

  private assertStorageKey(storageKey: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(storageKey)) throw new Error("Invalid private document storage key.");
  }

  private matchesSignature(signature: Buffer, mediaType: DocumentMediaType): boolean {
    if (mediaType === "application/pdf") return signature.subarray(0, 5).toString("ascii") === "%PDF-";
    if (mediaType === "image/png") return signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  }
}

async function renamePrivateFile(source: string, destination: string): Promise<void> {
  await rename(source, destination);
  const file = await open(destination, "r");
  try { await file.chmod(0o600); }
  finally { await file.close(); }
}
