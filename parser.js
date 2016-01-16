/**
 * Class creating a Source 2 Dota 2 replay parser
 **/
var ProtoBuf = require('protobufjs');
var snappy = require('./snappy');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var stream = require('stream');
var types = require('./build/types.json');
var protos = require('./build/protos.json');
var demTypes = types.dems;
//read the protobufs and build a dota object for reference
var builder = ProtoBuf.newBuilder();
ProtoBuf.loadJson(protos, builder);
var dota = builder.build();
//CDemoSignonPacket is a special case and should be decoded with CDemoPacket since it doesn't have its own protobuf
//it appears that things like the gameeventlist and createstringtables calls are here?
dota["CDemoSignonPacket"] = dota["CDemoPacket"];
dota["CDOTAUserMsg_CombatLogDataHLTV"] = dota["CMsgDOTACombatLogEntry"];
//console.error(Object.keys(dota));
var Parser = function(input, options) {
    //if a JS ArrayBuffer, convert to native node buffer
    if (input.byteLength) {
        input = new Buffer(input);
    }
    //wrap a passed buffer in a stream
    if (Buffer.isBuffer(input)) {
        var bufferStream = new stream.PassThrough();
        bufferStream.end(input);
        input = bufferStream;
    }
    var stop = false;
    var p = new EventEmitter();
    //the following properties are exposed to the user to help interpret messages
    p.types = types;
    p.dota = dota;
    p.classIdSize = 0;
    p.gameEventDescriptors = {};
    p.classInfo = {};
    p.serializers = {};
    p.entities = {};
    p.baselines = {};
    p.stringTables = {
        tables: [],
        tablesByName: {}
    };
    /**
     * Begins parsing the replay.
     **/
    p.start = function start(cb) {
        input.on('end', function() {
            stop = true;
            input.removeAllListeners();
            return cb();
        });
        async.series({
            "header": function(cb) {
                readString(8, function(err, header) {
                    //verify the file magic number is correct
                    cb(err || header.toString() !== "PBDEMS2\0", header);
                });
            },
            //two uint32s related to replay size
            "size1": readUInt32,
            "size2": readUInt32,
            "demo": function(cb) {
                //keep parsing demo messages until it hits a stop condition
                async.until(function() {
                    return stop;
                }, readDemoMessage, cb);
            }
        }, cb);
    };
    /**
     * Returns whether there is an attached listener for this message name.
     **/
    p.isListening = function isListening(name) {
        return p.listeners(name).length || p.listeners("*").length;
    };
    /**
     * Given the current state of string tables and class info, updates the baseline state.
     * This is state that is maintained throughout the parse and is used as fallback when fetching entity properties.
     **/
    p.updateInstanceBaseline = function updateInstanceBaseline() {
        //TODO
        // We can't update the instancebaseline until we have class info.
        if (!Object.keys(p.classInfo)) {
            return;
        }
        /*
        	stringTable, ok := p.StringTables.GetTableByName("instancebaseline")
        	if !ok {
        		_debugf("skipping updateInstanceBaseline: no instancebaseline string table")
        		return
        	}

        	// Iterate through instancebaseline table items
        	for _, item := range stringTable.Items {
        		        
            	// Get the class id for the string table item
            	classId, err := atoi32(item.Key)
            	if err != nil {
            		_panicf("invalid instancebaseline key '%s': %s", item.Key, err)
            	}
            
            	// Get the class name
            	className, ok := p.ClassInfo[classId]
            	if !ok {
            		_panicf("unable to find class info for instancebaseline key %d", classId)
            	}
            
            	// Create an entry in the map if needed
            	if _, ok := p.ClassBaselines[classId]; !ok {
            		p.ClassBaselines[classId] = NewProperties()
            	}
            
            	// Get the send table associated with the class.
            	serializer, ok := p.serializers[className]
            	if !ok {
            		_panicf("unable to find send table %s for instancebaseline key %d", className, classId)
            	}
            
            	// Uncomment to dump fixtures
            	//_dump_fixture("instancebaseline/1731962898_"+className+".rawbuf", item.Value)
            
            	// Parse the properties out of the string table buffer and store
            	// them as the class baseline in the Parser.
            	if len(item.Value) > 0 {
            		_debugfl(1, "Parsing entity baseline %v", serializer[0].Name)
            		r := NewReader(item.Value)
            		p.ClassBaselines[classId] = ReadProperties(r, serializer[0])
            		// Inline test the baselines
            		if testLevel >= 1 && r.remBits() > 8 {
            			_panicf("Too many bits remaining in baseline %v, %v", serializer[0].Name, r.remBits())
            		}
            }
            */
    };
    /**
     * Internal listeners to automatically process certain packets.
     * We abstract this away from the user so they don't need to worry about it.
     * For optimal speed we could allow the user to disable the ones they don't need
     **/
    require("./packets")(p);
    require("./stringTables")(p);
    //require("./entities")(p);
    p.on("CDemoStop", function(data) {
        //don't stop on CDemoStop since some replays have CDemoGameInfo after it
        //stop = true;
    });
    return p;
    /**
     * Reads the next DEM message from the replay (outer message)
     * This method is asynchronous since we may not have the entire message yet if streaming
     **/
    function readDemoMessage(cb) {
        async.series({
            command: readVarUInt,
            tick: readVarUInt,
            size: readVarUInt
        }, function(err, result) {
            if (err) {
                return cb(err);
            }
            readBuffer(result.size, function(err, buf) {
                // Read a command header, which includes both the message type
                // well as a flag to determine whether or not whether or not the
                // message is compressed with snappy.
                var command = result.command;
                var tick = result.tick;
                var size = result.size;
                // Extract the type and compressed flag out of the command
                //msgType: = int32(command & ^ dota.EDemoCommands_DEM_IsCompressed)
                //msgCompressed: = (command & dota.EDemoCommands_DEM_IsCompressed) == dota.EDemoCommands_DEM_IsCompressed
                var demType = command & ~dota.EDemoCommands.DEM_IsCompressed;
                var isCompressed = (command & dota.EDemoCommands.DEM_IsCompressed) === dota.EDemoCommands.DEM_IsCompressed;
                // Read the tick that the message corresponds with.
                //tick: = p.reader.readVarUint32()
                // This appears to actually be an int32, where a -1 means pre-game.
                /*
                if tick == 4294967295 {
                        tick = 0
                }
                */
                if (tick === 4294967295) {
                    tick = 0;
                }
                if (isCompressed) {
                    buf = snappy.uncompressSync(buf);
                }
                var dem = {
                    tick: tick,
                    type: demType,
                    size: size,
                    data: buf
                };
                //console.error(dem);
                if (demType in demTypes) {
                    //lookup the name of the protobuf message to decode with
                    var name = demTypes[demType];
                    if (dota[name]) {
                        if (p.isListening(name)) {
                            dem.data = dota[name].decode(dem.data);
                            p.emit("*", dem.data, name);
                            p.emit(name, dem.data, name);
                        }
                    }
                    else {
                        console.error("no proto definition for dem type %s", demType);
                    }
                }
                else {
                    console.error("no proto name for dem type %s", demType);
                }
                return cb(err);
            });
        });
    }

    function readUInt8(cb) {
        readBuffer(1, function(err, buf) {
            cb(err, buf.readInt8(0));
        });
    }

    function readString(size, cb) {
        readBuffer(size, function(err, buf) {
            cb(err, buf.toString());
        });
    }

    function readUInt32(cb) {
        readBuffer(4, function(err, buf) {
            cb(err, buf.readUInt32LE(0));
        });
    }

    function readVarUInt(cb) {
        readUInt8(function(err, tmp) {
            if (tmp >= 0) {
                return cb(err, tmp);
            }
            var result = tmp & 0x7f;
            readUInt8(function(err, tmp) {
                if (tmp >= 0) {
                    result |= tmp << 7;
                    return cb(err, result);
                }
                else {
                    result |= (tmp & 0x7f) << 7;
                    readUInt8(function(err, tmp) {
                        if (tmp >= 0) {
                            result |= tmp << 14;
                            return cb(err, result);
                        }
                        else {
                            result |= (tmp & 0x7f) << 14;
                            readUInt8(function(err, tmp) {
                                if (tmp >= 0) {
                                    result |= tmp << 21;
                                    return cb(err, result);
                                }
                                else {
                                    result |= (tmp & 0x7f) << 21;
                                    readUInt8(function(err, tmp) {
                                        result |= tmp << 28;
                                        if (tmp < 0) {
                                            err = "malformed varint detected";
                                        }
                                        return cb(err, result);
                                    });
                                }
                            });
                        }
                    });
                }
            });
        });
    }

    function readBuffer(size, cb) {
        if (!size) {
            //return an empty buffer if reading 0 bytes
            return cb(null, new Buffer(""));
        }
        var buf = input.read(size);
        if (buf) {
            return cb(null, buf);
        }
        else {
            input.once('readable', function() {
                return readBuffer(size, cb);
            });
        }
    }
};
global.Parser = Parser;
module.exports = Parser;
