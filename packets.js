var BitStream = require('./BitStream');
var util = require('./util');
var extractBuffer = util.extractBuffer;
module.exports = function(p) {
    var dota = p.dota;
    var packetTypes = p.types.packets;
    p.on("CDemoSignonPacket", readCDemoPacket);
    p.on("CDemoPacket", readCDemoPacket);
    p.on("CDemoFullPacket", function(data) {
        //console.error(data);
        //readCDemoStringTables(data.string_table);
        readCDemoPacket(data.packet);
    });
    //this packet sets up our game event descriptors
    p.on("CMsgSource1LegacyGameEventList", function(msg) {
        //console.error(data);
        var gameEventDescriptors = p.gameEventDescriptors;
        for (var i = 0; i < msg.descriptors.length; i++) {
            gameEventDescriptors[msg.descriptors[i].eventid] = msg.descriptors[i];
        }
    });
    /**
     * Processes a DEM message containing inner packets.
     * This is the main structure that contains all other data types in the demo file.
     **/
    function readCDemoPacket(msg) {
        /*
        message CDemoPacket {
        	optional int32 sequence_in = 1;
        	optional int32 sequence_out_ack = 2;
        	optional bytes data = 3;
        }
        */
        var priorities = {
            "CNETMsg_Tick": -10,
            "CSVCMsg_CreateStringTable": -10,
            "CSVCMsg_UpdateStringTable": -10,
            "CNETMsg_SpawnGroup_Load": -10,
            "CSVCMsg_PacketEntities": 5,
            "CMsgSource1LegacyGameEvent": 10
        };
        //the inner data of a CDemoPacket is raw bits (no longer byte aligned!)
        var packets = [];
        //extract the native buffer from the ByteBuffer decoded by protobufjs
        var buf = extractBuffer(msg.data);
        //convert the buffer object into a bitstream so we can read bits from it
        var bs = BitStream(buf);
        //read until less than 8 bits left
        while (bs.limit - bs.offset >= 8) {
            var t = bs.readUBitVar();
            var s = bs.readVarUInt();
            var d = bs.readBuffer(s * 8);
            var name = packetTypes[t];
            var pack = {
                type: t,
                size: s,
                data: d,
                position: packets.length
            };
            packets.push(pack);
        }
        //sort the inner packets by priority in order to ensure we parse dependent packets last
        packets.sort(function(a, b) {
            //we must use a stable sort here in order to preserve order of packets when possible (for example, string tables must be parsed in the correct order or their ids are no longer valid)
            var p1 = priorities[packetTypes[a.type]] || 0;
            var p2 = priorities[packetTypes[b.type]] || 0;
            if (p1 === p2) {
                return a.position - b.position;
            }
            return p1 - p2;
        });
        for (var i = 0; i < packets.length; i++) {
            var packet = packets[i];
            var packType = packet.type;
            if (packType in packetTypes) {
                //lookup the name of the proto message for this packet type
                var name = packetTypes[packType];
                if (dota[name]) {
                    if (p.isListening(name)) {
                        packet.data = dota[name].decode(packet.data);
                        p.emit("*", packet.data, name);
                        p.emit(name, packet.data, name);
                    }
                }
                else {
                    console.error("no proto definition for packet name %s", name);
                }
            }
            else {
                console.error("no proto name for packet type %s", packType);
            }
        }
    }
}