export function decodeBase64(value) {
  let normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function decompressGzip(bytes) {
  try {
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
    const output = new Uint8Array(await new Response(stream).arrayBuffer());
    if (output.length > 20_000_000) throw new Error("Decoded inventory exceeded the safety limit.");
    return output;
  } catch (error) {
    if (bytes[0] === 10) return bytes;
    throw error;
  }
}

export class NbtReader {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("NBT input was not binary data.");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.decoder = new TextDecoder("utf-8");
  }

  readRoot() {
    const type = this.readUint8();
    if (type === 0) return {};
    this.readString();
    return this.readPayload(type, 0);
  }

  readPayload(type, depth) {
    if (depth > 64) throw new Error("NBT nesting exceeded the safety limit.");

    switch (type) {
      case 0:
        return null;
      case 1:
        return this.readInt8();
      case 2:
        return this.readInt16();
      case 3:
        return this.readInt32();
      case 4:
        return this.readInt64();
      case 5:
        return this.readFloat32();
      case 6:
        return this.readFloat64();
      case 7: {
        const length = this.readArrayLength();
        return Array.from(this.readBytes(length));
      }
      case 8:
        return this.readString();
      case 9: {
        const itemType = this.readUint8();
        const length = this.readArrayLength(100_000);
        const list = [];
        for (let index = 0; index < length; index += 1) {
          list.push(this.readPayload(itemType, depth + 1));
        }
        return list;
      }
      case 10: {
        const compound = {};
        while (true) {
          const childType = this.readUint8();
          if (childType === 0) break;
          const name = this.readString();
          compound[name] = this.readPayload(childType, depth + 1);
        }
        return compound;
      }
      case 11: {
        const length = this.readArrayLength();
        const values = [];
        for (let index = 0; index < length; index += 1) values.push(this.readInt32());
        return values;
      }
      case 12: {
        const length = this.readArrayLength();
        const values = [];
        for (let index = 0; index < length; index += 1) values.push(this.readInt64());
        return values;
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}.`);
    }
  }

  readString() {
    const length = this.readUint16();
    return this.decoder.decode(this.readBytes(length));
  }

  readArrayLength(maximum = 2_000_000) {
    const length = this.readInt32();
    if (length < 0 || length > maximum) throw new Error("NBT array length was invalid.");
    return length;
  }

  readBytes(length) {
    this.ensure(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readUint8() {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt8() {
    this.ensure(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt16() {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readInt64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }

  readFloat32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat64() {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  ensure(length) {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("NBT data ended unexpectedly.");
    }
  }
}
