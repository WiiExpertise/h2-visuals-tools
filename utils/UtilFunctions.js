const { BitView } = require('bit-buffer');
const zlib = require('zlib');

// Function to decompress a gzip compressed buffer
function decompressBuffer(compressedBuffer) 
{
    try 
    {
        const result = zlib.gunzipSync(compressedBuffer);
        return result;
    } 
    catch (err) 
    {
        console.error('An error occurred during inflation:', err);
    }
}

// Function to gzip compress a buffer
function compressBuffer(buffer) 
{
    try 
    {
        const result = zlib.gzipSync(buffer);
        return result;
    } 
    catch (err) 
    {
        console.error('An error occurred during deflation:', err);
    }
}
    
// Convert object keys to lowercase
function normalizeKeys(obj) 
{
    return Object.keys(obj).reduce((acc, key) => {
        acc[key.toLowerCase()] = obj[key];
        return acc;
    }, {});
}

// Function to read a modified LEB128 encoded number
function readModifiedLebEncodedNumber(parser)
{
    let byteArray = [];
    let currentByte;

    do
    {
        currentByte = parser.readByte().readUInt8(0);
        byteArray.push(currentByte);
    }
    while((currentByte & 0x80));
    
    let value = 0;
    let isNegative = false;

    const buf = Buffer.from(byteArray);

    for (let i = (buf.length - 1); i >= 0; i--) {
        let currentByte = buf.readUInt8(i);

        if (i !== (buf.length - 1)) {
        currentByte = currentByte ^ 0x80;
        }

        if (i === 0 && (currentByte & 0x40) === 0x40) {
        currentByte = currentByte ^ 0x40;
        isNegative = true;
        }

        let multiplicationFactor = 1 << (i * 6);

        if (i > 1) {
        multiplicationFactor = multiplicationFactor << 1;
        }

        value += currentByte * multiplicationFactor;

        if (isNegative) {
        value *= -1;
        }
    }

    return value;
}

// Function to convert a number to the modified LEB128 encoding
function writeModifiedLebEncodedNumber(value) 
{
    const isNegative = value < 0;
    value = Math.abs(value);

    // Calculate the factors as used by the read function
    // Factor formula: 1 << (i * 6), then << 1 if i > 1
    const calculateFactor = (i) => {
        let factor = 1 << (i * 6);
        if (i > 1) {
        factor = factor << 1;
        }
        return factor;
    };

    // Find how many bytes we need
    let numBytes = 1;
    let testValue = value;
    while (testValue >= calculateFactor(numBytes - 1) * (numBytes === 1 ? 64 : 128)) {
        numBytes++;
    }

    // Decompose the value using the factors
    let remaining = value;
    let components = new Array(numBytes);
    
    for (let i = numBytes - 1; i >= 0; i--) {
        const factor = calculateFactor(i);
        const maxValue = (i === 0) ? 63 : 127; // First byte has 6 bits, others have 7
        
        components[i] = Math.floor(remaining / factor);
        if (components[i] > maxValue) {
        components[i] = maxValue;
        }
        remaining -= components[i] * factor;
    }

    // Handle any remaining value by adjusting the last components
    if (remaining > 0) {
        for (let i = 0; i < numBytes && remaining > 0; i++) {
        const factor = calculateFactor(i);
        const maxValue = (i === 0) ? 63 : 127;
        const canAdd = Math.min(maxValue - components[i], Math.floor(remaining / factor));
        components[i] += canAdd;
        remaining -= canAdd * factor;
        }
    }

    // Build the bytes
    let bytes = [];
    for (let i = 0; i < numBytes; i++) {
        let byte = components[i];
        
        if (i === 0) {
        // First byte: add sign bit if negative
        if (isNegative) {
            byte |= 0x40;
        }
        // Add continuation bit if there are more bytes
        if (numBytes > 1) {
            byte |= 0x80;
        }
        } else {
        // Subsequent bytes: add continuation bit if there are more bytes after this one
        if (i < numBytes - 1) {
            byte |= 0x80;
        }
        }
        
        bytes.push(byte);
    }
    
    return Buffer.from(bytes);
}

// Function to get uncompressed text from a 6-bit compressed buffer
function getUncompressedTextFromSixBitCompression(data) 
{
    const bv = new BitView(data, data.byteOffset);
    bv.bigEndian = true;
    const numCharacters = (data.length * 8) / 6;
    
    let text = '';

    for (let i = 0; i < numCharacters; i++) 
    {
        text += String.fromCharCode(getCharCode(i * 6));
    }

    return text;

    function getCharCode(offset) 
    {
        return bv.getBits(offset, 6) + 32;
    }
}

// Function to convert a character to a 6-bit value
function charTo6Bit(c) {
    // Map A-Z to 0-25, 0-9 to 26-35
    if (c >= 'A' && c <= 'Z') 
    {
        return (c.charCodeAt(0) - 32);
    }
    else if (c >= '0' && c <= '9') 
    {
        return c.charCodeAt(0) - 32;
    }
    throw new Error("Unsupported character: " + c);
}

// Function to compress a 4 character string to a 3 byte representation
function compress6BitString(str) 
{
    if (str.length !== 4) 
    {
        throw new Error("Input string must be exactly 4 characters");
    }

    // Convert each character to 6-bit value
    let bits = [];
    for (let i = 0; i < 4; i++) 
    {
        bits.push(charTo6Bit(str[i]));
    }

    // Pack the 6-bit values into 3 bytes
    let byte1 = (bits[0] << 2) | (bits[1] >> 4);
    let byte2 = ((bits[1] & 0xF) << 4) | (bits[2] >> 2);
    let byte3 = ((bits[2] & 0x3) << 6) | bits[3];

    return [byte1, byte2, byte3];
}

module.exports = {
    decompressBuffer,
    compressBuffer,
    normalizeKeys,
    readModifiedLebEncodedNumber,
    writeModifiedLebEncodedNumber,
    getUncompressedTextFromSixBitCompression,
    compress6BitString
};