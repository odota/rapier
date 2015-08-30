/**
 * A pure JS implementation of Snappy decompression, for use in the browser
 **/
var ByteBuffer = require('bytebuffer');
module.exports = {
    //TODO optimize speed by using native buffer or node binding?
    uncompressSync: function(buf) {
        var input = ByteBuffer.wrap(buf);
        var size = input.readVarint32();
        var output = new ByteBuffer(size);
        output.offset = 0;
        output.length = size;
        input.littleEndian = true;
        var copy = function(output, length, offset) {
            var ptr = output.offset - offset;
            for (var i = 0; i < length; ++i) {
                output.writeByte(output.readByte(ptr + i));
            }
        };
        while (input.remaining()) {
            var tag = input.readUint8();
            switch (tag & 3) {
                case 0:
                    var length = (tag >> 2) + 1;
                    if (length >= 61) {
                        var bytes = length - 60;
                        length = 0;
                        for (var i = 0; i < bytes; ++i) {
                            length |= input.readUint8() << (8 * i);
                        }
                        length++;
                    }
                    for (var i = 0; i < length; ++i) {
                        output.writeByte(input.readByte());
                    }
                    break;
                case 1:
                    var length = ((tag >> 2) & 7) + 4;
                    var offset = ((tag >> 5) << 8) | input.readUint8();
                    copy(output, length, offset);
                    break;
                case 2:
                    var length = (tag >> 2) + 1;
                    var offset = input.readUint16();
                    copy(output, length, offset);
                    break;
                case 3:
                    var length = (tag >> 2) + 1;
                    var offset = input.readUint32();
                    copy(output, length, offset);
                    break;
            };
        }
        output.offset = 0;
        return output.toBuffer();
    }
};
/*
//attempt to use native node buffer
function uncompressSync(buf) {
    var readOffset = 0;
    var writeOffset = 0;
    //TODO implement reading of varint from native buffer
    var size = buf.readVarint32();
    var output = new Buffer(size);
    var copy = function(output, length, offset) {
        var ptr = writeOffset - offset;
        for (var i = 0; i < length; ++i) {
            output.writeUInt8LE(output.readUInt8(ptr + i));
        }
    };
    while (readOffset<size) {
        var tag = buf.readUint8();
        switch (tag & 3) {
            case 0:
                var length = (tag >> 2) + 1;
                if (length >= 61) {
                    var bytes = length - 60;
                    length = 0;
                    for (var i = 0; i < bytes; ++i) {
                        length |= buf.readUInt8() << (8 * i);
                    }
                    length++;
                }
                for (var i = 0; i < length; ++i) {
                    output.writeUInt8LE(buf.readUInt8);
                }
                break;
            case 1:
                var length = ((tag >> 2) & 7) + 4;
                var readOffset = ((tag >> 5) << 8) | buf.readUInt8();
                copy(output, length, readOffset);
                break;
            case 2:
                var length = (tag >> 2) + 1;
                var readOffset = buf.readUInt16LE();
                copy(output, length, readOffset);
                break;
            case 3:
                var length = (tag >> 2) + 1;
                var readOffset = buf.readUInt32LE();
                copy(output, length, readOffset);
                break;
        };
    }
    return output;
};
*/