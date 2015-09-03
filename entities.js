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
        //create a new flattened serializer
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
            //throw "stop";
        });
        p.serializers = fs;
    });
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
                    //currently using version 0 for everything
                    var dt = p.serializers[className][0];
                    var pe = {
                        index: index,
                        classId: classId,
                        className: className,
                        dt: dt,
                        properties: {},
                    };
                    // Skip the 10 serial bits for now.
                    bs.readBits(10);
                    // Read properties and set them in the packetEntity
                    pe.properties = readEntityProperties(bs, pe.dt);
                    p.entities[index] = pe;
                    break;
                case "U":
                    // Find the existing packetEntity
                    var pe = p.entities[index];
                    // Read properties and update the packetEntity
                    var properties = readEntityProperties(bs, pe.dt);
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
        function decodeFloat(bs, f) {
            //TODO special case if field.encoder="coord"
            if (!f.bitCount) {
                //decode as float with certain number of bits
                return decodeBitFloat(bs, f);
            }
            else {
                //decode as 32 bit varint
                return bs.readVarUInt();
            }
        }

        function decodeBitFloat(bs, f) {
            var bits = bs.readBits(f.bitCount);
            //convert the int32 represented here to a float
            //TODO read these bits as a 32 bit float
            //we need to write the 32bit int to a 4 byte buffer, then we can interpret it as a float
            console.error(bits);
            throw "stop";
            return;
        }

        function decodeUnsigned(bs, f) {
            //TODO handle weird cases with unsigned int properties
            /*
	switch (f.encoder) {
	case "fixed64":
		return decodeFixed64(r, f)
	case "le64":
		return decodeLeUint64(r, f)
	}
	*/
            return bs.readVarUInt64();
        }

        function decodeSigned(bs, f) {
            return bs.readVarInt();
        }

        function decodeString(bs, f) {
            return bs.readNullTerminatedString();
        }

        function decodeFVector(bs, f) {
            //TODO
            /*
	    // Parse specific encoders
	switch f.Encoder {
	case "normal":
		return r.read3BitNormal()
	}
	*/
            return [decodeFloat(bs, f), decodeFloat(bs, f), decodeFloat(bs, f)];
        }

        function decodeBoolean(bs, f) {
            return bs.readBoolean();
        }

        function decodeQuantized(bs, f) {
            //TODO implement this instead of just skipping
            return bs.readBits(f.bitCount);
        }

        function decodeComponent(bs, f) {
            return bs.readBits(1);
        }

        function decodeQAngle(bs, f) {
            /*
	    	ret := [3]float32{0.0, 0.0, 0.0}

	// Parse specific encoders
	switch f.Encoder {
	case "qangle_pitch_yaw":
		if f.BitCount != nil && f.Flags != nil && (*f.Flags&0x20 != 0) {
			_panicf("Special Case: Unkown for now")
		}

		ret[0] = r.readAngle(uint(*f.BitCount))
		ret[1] = r.readAngle(uint(*f.BitCount))
		return ret
	}

	// Parse a standard angle
	if f.BitCount != nil && *f.BitCount == 32 {
		_panicf("Special Case: Unkown for now")
	} else if f.BitCount != nil && *f.BitCount != 0 {
		ret[0] = r.readAngle(uint(*f.BitCount))
		ret[1] = r.readAngle(uint(*f.BitCount))
		ret[2] = r.readAngle(uint(*f.BitCount))

		return ret
	} else {
		rX := r.readBoolean()
		rY := r.readBoolean()
		rZ := r.readBoolean()

		if rX {
			ret[0] = r.readCoord()
		}

		if rY {
			ret[1] = r.readCoord()
		}

		if rZ {
			ret[2] = r.readCoord()
		}

		return ret
	}

	_panicf("No valid encoding determined")
	return ret
	*/
        }

        function decodeHandle(bs, f) {
            return bs.readVarUInt();
        }
        var decoder = serializer.decoder;
        //each decode function takes a bitstream to read from and the field properties
        //try to use field.type to determine the serializer to use
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
                decoder = decodeQuantized;
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
                    console.error("no decoder for %s", field.name);
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
        var arrayMatch = arrayRegex.exec(name);
	if (arrayMatch.length > 1) {
		var typeName := arrayMatch[2];
		var length = String.parseInt(arrayMatch[3], 10);
        //this property is an array
        //we can use an existing serializer
		return ps
	}
	*/
        //matches the vector regex
        /*
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
     * Given a bitstream and a dt for this entity class, return a mapping of properties
     * The dt contains the information about the fields in this entity, and includes methods to decode the raw bits
     * The list of fields is encoded at the start of the bitstream
     * We interpret it by reading a bit at a time from bitstream and walking the huffman tree based on the bit
     * At each node, we perform a fieldpath operation
     * If we haven't ended our walk, we add a field
     * The rest of the stream contains the encoded properties.
     **/
    function readEntityProperties(bs, dt) {
        //TODO implement this
        var result = {};
        //create a new fieldpath object
        var fieldpath = {
            parent: dt,
            fields: [],
            //start with a -1 index for the path
            indexes: [-1],
            tree: huf,
            finished: false
        };
        //walk the huffman tree while reading from bitstream and set the array of fields 
        //each field is an object with name and dt_field
        fieldpath.fields = walk(bs, fieldpath);
        /*
	// Return type
	result = NewProperties()

	// Create fieldpath
	fieldPath := newFieldpath(ser, &huf)

	// Get a list of the included fields
	fieldPath.walk(r)

	// iterate all the fields and set their corresponding values
	for _, f := range fieldPath.fields {
		_debugfl(6, "Decoding field %d %s %s", r.pos, f.Name, f.Field.Type)
		// r.dumpBits(1)

		if f.Field.Serializer.DecodeContainer != nil {
			_debugfl(6, "Decoding container %v", f.Field.Name)
			result.KV[f.Name] = f.Field.Serializer.DecodeContainer(r, f.Field)
		} else if f.Field.Serializer.Decode == nil {
			result.KV[f.Name] = r.readVarUint32()
			_debugfl(6, "Decoded default: %d %s %s %v", r.pos, f.Name, f.Field.Type, result.KV[f.Name])
			continue
		} else {
			result.KV[f.Name] = f.Field.Serializer.Decode(r, f.Field)
		}

		_debugfl(6, "Decoded: %d %s %s %v", r.pos, f.Name, f.Field.Type, result.KV[f.Name])
	}

	return result
    	*/
        return result;
    }
    /**
     * Given an array of counts, builds a huffman tree
     **/
    function buildTree(counts) {
        //TODO implement
    }

    function walk(bs, fieldpath) {}
    // Global fieldpath lookup array
    //name, function, weight
    /*
var fieldpathOperations = [
	{"PlusOne", PlusOne, 36271},
	{"PlusTwo", PlusTwo, 10334},
	{"PlusThree", PlusThree, 1375},
	{"PlusFour", PlusFour, 646},
	{"PlusN", PlusN, 4128},
	{"PushOneLeftDeltaZeroRightZero", PushOneLeftDeltaZeroRightZero, 35},
	{"PushOneLeftDeltaZeroRightNonZero", PushOneLeftDeltaZeroRightNonZero, 3},
	{"PushOneLeftDeltaOneRightZero", PushOneLeftDeltaOneRightZero, 521},
	{"PushOneLeftDeltaOneRightNonZero", PushOneLeftDeltaOneRightNonZero, 2942},
	{"PushOneLeftDeltaNRightZero", PushOneLeftDeltaNRightZero, 560},
	{"PushOneLeftDeltaNRightNonZero", PushOneLeftDeltaNRightNonZero, 471},
	{"PushOneLeftDeltaNRightNonZeroPack6Bits", PushOneLeftDeltaNRightNonZeroPack6Bits, 10530},
	{"PushOneLeftDeltaNRightNonZeroPack8Bits", PushOneLeftDeltaNRightNonZeroPack8Bits, 251},
	{"PushTwoLeftDeltaZero", PushTwoLeftDeltaZero, 0},
	{"PushTwoPack5LeftDeltaZero", PushTwoPack5LeftDeltaZero, 0},
	{"PushThreeLeftDeltaZero", PushThreeLeftDeltaZero, 0},
	{"PushThreePack5LeftDeltaZero", PushThreePack5LeftDeltaZero, 0},
	{"PushTwoLeftDeltaOne", PushTwoLeftDeltaOne, 0},
	{"PushTwoPack5LeftDeltaOne", PushTwoPack5LeftDeltaOne, 0},
	{"PushThreeLeftDeltaOne", PushThreeLeftDeltaOne, 0},
	{"PushThreePack5LeftDeltaOne", PushThreePack5LeftDeltaOne, 0},
	{"PushTwoLeftDeltaN", PushTwoLeftDeltaN, 0},
	{"PushTwoPack5LeftDeltaN", PushTwoPack5LeftDeltaN, 0},
	{"PushThreeLeftDeltaN", PushThreeLeftDeltaN, 0},
	{"PushThreePack5LeftDeltaN", PushThreePack5LeftDeltaN, 0},
	{"PushN", PushN, 0},
	{"PushNAndNonTopological", PushNAndNonTopological, 310},
	{"PopOnePlusOne", PopOnePlusOne, 2},
	{"PopOnePlusN", PopOnePlusN, 0},
	{"PopAllButOnePlusOne", PopAllButOnePlusOne, 1837},
	{"PopAllButOnePlusN", PopAllButOnePlusN, 149},
	{"PopAllButOnePlusNPack3Bits", PopAllButOnePlusNPack3Bits, 300},
	{"PopAllButOnePlusNPack6Bits", PopAllButOnePlusNPack6Bits, 634},
	{"PopNPlusOne", PopNPlusOne, 0},
	{"PopNPlusN", PopNPlusN, 0},
	{"PopNAndNonTopographical", PopNAndNonTopographical, 1},
	{"NonTopoComplex", NonTopoComplex, 76},
	{"NonTopoPenultimatePlusOne", NonTopoPenultimatePlusOne, 271},
	{"NonTopoComplexPack4Bits", NonTopoComplexPack4Bits, 99},
	{"FieldPathEncodeFinish", FieldPathEncodeFinish, 25474}
]
*/
    //TODO build a huffman tree from the operation weights
    //these are always the same, so can reuse the tree?
    //convert to array of weights?
    //then value=index, weight=array[index]
    //construct the tree by using a priority queue (heap)
    //push all the elements into the heap with custom comparator
    //pop them out in sorted order
    //to build the tree:
    //pop two elements out
    //construct a new node with value=sum of the two, left/right children, then push the new node into the 
    //repeat until heap only has one element left
    //this element is the root of the tree, return it
    var huf = buildTree();
}