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
        //three properties, serializers, symbols, and fields
        var fields = data.fields;
        //console.log(Object.keys(data));
        var fs = {
            serializers: {},
            //proto: data,
            propertySerializers: {}
        };
        //serializers are stored in an array
        data.serializers.forEach(function(s) {
            var name = data.symbols[s.serializer_name_sym];
            var version = s.serializer_version;
            if (!(name in fs.serializers)) {
                fs.serializers[name] = {};
            }
            //Construct a dt (data table) for this serializer
            //There is one for each entity name, and it holds the properties that an entity of that name should have, as well as logic that tells us how to decode it
            var dt = {
                name: name,
                version: version,
                properties: []
            };
            //each serializer has an array of field indices.  We want to create a property for each of these.
            s.fields_index.forEach(function(idx) {
                //get the field data
                var pField = fields[idx];
                //create a new field
                var field = {
                    name: data.symbols[pField.var_name_sym],
                    type: data.symbols[pField.var_type_sym],
                    index: -1,
                    flags: pField.encode_flags,
                    bitCount: pField.bit_count,
                    lowValue: pField.low_value,
                    highValue: pField.high_value,
                    version: pField.field_serializer_version,
                    encoder: data.symbols[pField.var_encoder_sym]
                };
                //add a serializer to the field based on its properties (name and type)
                field.serializer = getSerializer(field);
                //console.log(field);
                //put the field in a new property
                var prop = {
                    field: field,
                    table: null
                };
                //TODO handle arrays
                //TODO prop.table?
                dt.properties.push(prop);
            });
            fs.serializers[name][version] = dt;
            console.log(dt);
            throw "stop";
        });
        p.serializers = fs;
    });
    //TODO entities. huffman trees, property decoding?!
    p.on("CSVCMsg_PacketEntities", function(msg) {
        //packet entities are contained in a buffer in this packet
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
     * Given a field, return a serializer object for it.
     **/
    function getSerializer(field) {
        var name = field.name;
        var type = field.type;
        //TODO cache serializers by name so we don't have to reconstruct it every time
        //return it here if we have it cached
        //construct a new serializer object
        var serializer = {
            decoder: null,
            isArray: false,
            length: 0,
            arraySerializer: null,
            name: null
        };
        //certain fields require special serializers.  Identify them by name.
        /*
        	// Handle special decoders that need the complete field data here
	switch field.Name {
	case "m_flSimulationTime":
		field.Serializer = &PropertySerializer{decodeSimTime, nil, false, 0, nil, "unkown"}
		return
	case "m_flAnimTime":
		field.Serializer = &PropertySerializer{decodeSimTime, nil, false, 0, nil, "unkown"}
		return
	}
	*/
        var decoder = serializer.decoder;
        //each decode function takes a bitstream to read from and the field properties
        //try to use field.type to determine the serializer to use
        //TODO implement decoder functions
        switch (type) {
            case "float32":
                decoder = decodeFloat;
                break;
            case "int8":
            case "int16":
            case "int32":
            case "int64":
                decoder = decodeSigned;
                break;
            case "uint8":
            case "uint16":
            case "uint32":
            case "uint64":
            case "Color":
                decoder = decodeUnsigned;
                break;
            case "char":
            case "CUtlSymbolLarge":
                decoder = decodeString;
                break;
            case "Vector":
                decoder = decodeFVector;
                break;
            case "bool":
                decoder = decodeBoolean;
                break;
            case "CNetworkedQuantizedFloat":
                decoder = decodeQuantized
                break;
            case "CRenderComponent":
            case "CPhysicsComponent":
            case "CBodyComponent":
                decoder = decodeComponent;
                break;
            case "QAngle":
                decoder = decodeQAngle;
                break;
            case "CGameSceneNodeHandle":
                decoder = decodeHandle;
                break;
            default:
                // check for specific name patterns
                if (name.indexOf("CHandle") === 0) {
                    decoder = decodeHandle;
                }
                else if (name.indexOf("CStrongHandle") === 0) {
                    decoder = decodeUnsigned;
                }
                else if (name.indexOf("CUtlVector< ") === 0) {
                    //TODO implement vector matching/decoding
                    /*
		    if match := matchVector.FindStringSubmatch(name); match != nil {
				decoderContainer = decodeVector
				decoder = pst.GetPropertySerializerByName(match[1]).Decode
			} else {
				_panicf("Unable to read vector type for %s", name)
			}
			*/
                }
                else {
                    console.error("no decoder for %s", field);
                }
        }
        // match all pointers as boolean
        if (name.slice(-1) === "*") {
            decoder = decodeBoolean;
        }
        var arrayRegex = /([^[\]]+)\[(\d+)]/;
        var vectorRegex = /CUtlVector\<\s(.*)\s>$/;
        //matches the array regex
        /*
	if match := matchArray.FindStringSubmatch(name); match != nil {
		typeName := match[1]
		length, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil {
			_panicf("Array length doesn't seem to be a number: %v", match[2])
		}

		serializer, found := pst.Serializers[typeName]
		if !found {
			serializer = pst.GetPropertySerializerByName(typeName)
			pst.Serializers[typeName] = serializer
		}

		ps := &PropertySerializer{
			Decode:          serializer.Decode,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(length),
			ArraySerializer: serializer,
			Name:            typeName,
		}
		pst.Serializers[name] = ps
		return ps
	}
//matches the vector regex
	if match := matchVector.FindStringSubmatch(name); match != nil {
		ps := &PropertySerializer{
			Decode:          decoder,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(128),
			ArraySerializer: &PropertySerializer{},
		}
		pst.Serializers[name] = ps
		return ps
	}
	*/
        /*

	if name == "C_DOTA_ItemStockInfo[MAX_ITEM_STOCKS]" {
		typeName := "C_DOTA_ItemStockInfo"

		serializer, found := pst.Serializers[typeName]
		if !found {
			serializer = pst.GetPropertySerializerByName(typeName)
			pst.Serializers[typeName] = serializer
		}

		ps := &PropertySerializer{
			Decode:          serializer.Decode,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(8),
			ArraySerializer: serializer,
			Name:            typeName,
		}

		pst.Serializers[name] = ps
		return ps
	}

	if name == "CDOTA_AbilityDraftAbilityState[MAX_ABILITY_DRAFT_ABILITIES]" {
		typeName := "CDOTA_AbilityDraftAbilityState"

		serializer, found := pst.Serializers[typeName]
		if !found {
			serializer = pst.GetPropertySerializerByName(typeName)
			pst.Serializers[typeName] = serializer
		}

		ps := &PropertySerializer{
			Decode:          serializer.Decode,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(48),
			ArraySerializer: serializer,
			Name:            typeName,
		}
		
			// That the type does not indicate an array is somewhat bad for the way we are
	// parsing things at the moment :(
	if name == "m_SpeechBubbles" {
		typeName := "m_SpeechBubbles"

		ps := &PropertySerializer{
			Decode:          decoder,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(5),
			ArraySerializer: nil,
			Name:            typeName,
		}

		pst.Serializers[name] = ps
		return ps
	}

	if name == "DOTA_PlayerChallengeInfo" {
		typeName := "DOTA_PlayerChallengeInfo"

		ps := &PropertySerializer{
			Decode:          decoder,
			DecodeContainer: decoderContainer,
			IsArray:         true,
			Length:          uint32(30),
			ArraySerializer: nil,
			Name:            typeName,
		}

		pst.Serializers[name] = ps
		return ps
	}
		*/
        return serializer;
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