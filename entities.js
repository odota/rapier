var BitStream = require('./BitStream');
module.exports = function(p) {
    var dota = p.dota;
    //contains some useful data for entity parsing
    p.on("CSVCMsg_ServerInfo", function(msg) {
        p.classIdSize = Math.log(msg.max_classes);
    });
    //stores mapping of entity class id to a string name
    p.on("CDemoClassInfo", function(msg) {
        msg.classes.forEach(function(c) {
            p.classInfo[c.class_id] = c.network_name;
        });
        // update the instancebaseline
        p.updateInstanceBaseline();
    });
    p.on("CDemoSendTables", function(msg) {
        //extract data
        var buf = new Buffer(msg.data.toBuffer());
        var bs = new BitStream(buf);
        //first bytes are a varuint
        var size = bs.readVarUInt();
        //next bytes are a CSVCMsg_FlattenedSerializer, decode with protobuf
        var data = bs.readBuffer(size * 8);
        data = dota.CSVCMsg_FlattenedSerializer.decode(data);
        var fs = {
            serializers: {},
            //proto: data,
            propertySerializers: {}
        };
        data.serializers.forEach(function(s) {
            var name = data.symbols[s.serializer_name_sym];
            var version = s.serializer_version;
            if (!(name in fs.serializers)) {
                fs.serializers[name] = {};
            }
            fs.serializers[name][version] = parseSerializer(s);
        });
        p.serializers = fs;
    });
    //TODO entities. huffman trees, property decoding?!
    p.on("CSVCMsg_PacketEntities", function(msg) {
        //packet entities are contained in a buffer in this packet
        //we also need to readproperties
        //where do baselines fit in?  instancebaseline stringtable?
        var buf = new Buffer(msg.entity_data.toBuffer());
        var bs = new BitStream(buf);
        var index = -1;
        return;
        //read as many entries as the message says to
        for (var i = 0; i < msg.updated_entries; i++) {
            // Read the index delta from the buffer.
            var delta = bs.readUBitVar();
            index += delta + 1;
            // Read the type of update based on two booleans.
            // This appears to be backwards from source 1:
            // true+true used to be "create", now appears to be false+true?
            var updateType = "";
            if (bs.readBoolean()) {
                if (bs.readBoolean()) {
                    //delete
                    updateType = "D";
                }
                else {
                    //XXX mystery type?
                    updateType = "?";
                }
            }
            else {
                if (bs.readBoolean()) {
                    //create
                    updateType = "C";
                }
                else {
                    //update
                    updateType = "U";
                }
            }
            // Proceed based on the update type
            switch (updateType) {
                case "C":
                    // Create a new packetEntity.
                    var classId = bs.readBits(p.server_info.classIdSize);
                    // Get the associated class for this entity id.  This is a name (string).
                    var className = p.classInfo[classId];
                    // Get the associated serializer.  These are keyed by entity name.
                    //TODO we need to create serializers
                    var flatTbl = p.serializers[className][0];
                    var pe = {
                        index: index,
                        classId: classId,
                        className: className,
                        flatTbl: flatTbl,
                        properties: {},
                    };
                    // Skip the 10 serial bits for now.
                    bs.readBits(10);
                    // Read properties and set them in the packetEntity
                    pe.properties = readEntityProperties(bs, pe.flatTbl);
                    p.entities[index] = pe;
                    break;
                case "U":
                    // Find the existing packetEntity
                    var pe = p.entities[index];
                    // Read properties and update the packetEntity
                    var properties = readEntityProperties(bs, pe.flatTbl);
                    for (var key in properties) {
                        pe.properties[key] = properties[key];
                    }
                    break;
                case "D":
                    delete p.entities[index];
                    break;
            }
        }
        return;
    });
    /**
     * Given a flattened serializer, reads its properties and return an object.
     **/
    function parseSerializer(s) {
        //TODO implement
    }
    /**
     * Given a bitstream and a property table, return a mapping of properties
     **/
    function readEntityProperties(bs, table) {
        //TODO implement this
        /*
	// Return type
	result = make(map[string]interface{})

	// Copy baseline if any
	if baseline != nil {
		for k, v := range baseline {
			result[k] = v
		}
	}

	// Create fieldpath
	fieldPath := newFieldpath(ser, &huf)

	// Get a list of the included fields
	fieldPath.walk(r)

	// iterate all the fields and set their corresponding values
	for _, f := range fieldPath.fields {
		if f.Field.Serializer.Decode == nil {
			result[f.Name] = r.readVarUint32()
			_debugfl(6, "Decoded default: %d %s %s %v", r.pos, f.Name, f.Field.Type, result[f.Name])
			continue
		}

		if f.Field.Serializer.DecodeContainer != nil {
			result[f.Name] = f.Field.Serializer.DecodeContainer(r, f.Field)
		} else {
			result[f.Name] = f.Field.Serializer.Decode(r, f.Field)
		}

		_debugfl(6, "Decoded: %d %s %s %v", r.pos, f.Name, f.Field.Type, result[f.Name])
	}

	return result
    	*/
        return;
    }
}