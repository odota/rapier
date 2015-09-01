/**
 * A pure JS implementation of Snappy decompression, for use in the browser
 **/
module.exports = {
    uncompressSync: function(buf) {
        var input = buf;
        var inputOffset = 0;
        var size = readVarUInt();
        var output = new Buffer(size);
        var outputOffset = 0;
        while (input.length > inputOffset) {
            var tag = readUInt8();
            switch (tag & 3) {
                case 0:
                    var length = (tag >> 2) + 1;
                    if (length >= 61) {
                        var bytes = length - 60;
                        length = 0;
                        for (var i = 0; i < bytes; ++i) {
                            var byte = readUInt8();
                            length |= byte << (8 * i);
                        }
                        length++;
                    }
                    for (var i = 0; i < length; ++i) {
                        writeUInt8(readUInt8());
                    }
                    break;
                case 1:
                    var length = ((tag >> 2) & 7) + 4;
                    var byte = readUInt8();
                    var offset = ((tag >> 5) << 8) | byte;
                    copy(output, length, offset);
                    break;
                case 2:
                    var length = (tag >> 2) + 1;
                    var offset = readUInt16LE();
                    copy(output, length, offset);
                    break;
                case 3:
                    var length = (tag >> 2) + 1;
                    var offset = readUInt32LE();
                    copy(output, length, offset);
                    break;
            };
        }
        return output;

        function copy(output, length, offset) {
            var ptr = outputOffset - offset;
            for (var i = 0; i < length; ++i) {
                writeUInt8(output.readUInt8(ptr + i));
            }
        }

        function readUInt8() {
            inputOffset += 1;
            return input.readUInt8(inputOffset - 1);
        }

        function readUInt16LE() {
            inputOffset += 2;
            return input.readUInt16LE(inputOffset - 2);
        }

        function readUInt32LE() {
            inputOffset += 4;
            return input.readUInt32LE(inputOffset - 4);
        }

        function writeUInt8(byte) {
            output.writeUInt8(byte, outputOffset);
            outputOffset += 1;
        }

        function readVarUInt() {
            var max = 32;
            var m = ((max + 6) / 7) * 7;
            var value = 0;
            var shift = 0;
            while (true) {
                var byte = readUInt8();
                value |= (byte & 0x7F) << shift;
                shift += 7;
                if ((byte & 0x80) === 0 || shift == m) {
                    return value;
                }
            }
        }
    }
};