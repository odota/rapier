var BitStream = require('./BitStream');
var Huffman = require('./huffman');
var util = require('./util');
var extractBuffer = util.extractBuffer;
module.exports = function(p) {
    //TODO p.entities[name] may not contain property we want.  in this case we fall back to baseline, but we should abstract it away from the user.
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
        var buf = extractBuffer(msg.data);
        var bs = BitStream(buf);
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
        var buf = extractBuffer(msg.entity_data);
        var bs = BitStream(buf);
        var index = -1;
        return;
        //TODO optimize by only processing the first full packet (check is_delta)
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
                    var pe = null;
                    if (p.entities[index]) {
                        //entity already exists
                        bs.readBits(p.classIdSize);
                        bs.readBits(25);
                        pe = p.entities[index];
                    }
                    else {
                        // Create a new packetEntity.
                        var classId = bs.readBits(p.classIdSize);
                        var serial = bs.readBits(25);
                        // Get the associated class for this entity id.  This is a name (string).
                        var className = p.classInfo[classId];
                        //get the baseline for this class (fallback for properties)
                        var classBaseline = p.baselines[classId];
                        // Get the associated serializer.  These are keyed by entity name.
                        //currently using version 0 for everything
                        var dt = p.serializers[className][0];
                        pe = {
                            index: index,
                            classId: classId,
                            serial: serial,
                            className: className,
                            classBaseline: classBaseline,
                            dt: dt,
                            properties: {}
                        };
                    }
                    // Read properties and merge them with existing properties
                    var properties = readEntityProperties(bs, pe.dt);
                    for (var key in properties) {
                        pe.properties[key] = properties[key];
                    }
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
        var decoder = null;
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
        serializer.decoder = decoder;
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
     * We interpret it by reading a bit at a time from bitstream and walking the huffman tree of fieldops based on the bit
     * A fieldpath operation modifies the current state of index by adjusting the last value by a certain amount
     * The value of the node is the index of the fieldpath operation
     * If we reach a leaf, we perform a fieldpath operation
     * If we haven't ended our walk, we add a field (also adds to index array)
     * Reset to root node
     * We finish with an array of fields and an array of corresponding indices
     * The rest of the stream contains the encoded properties.
     **/
    function readEntityProperties(bs, dt) {
        //TODO implement this fully
        var result = {};
        //create a new fieldpath object
        var fieldpath = {
            parent: dt,
            fields: [],
            //start with a -1 index for the path
            index: [-1],
            tree: huf,
            finished: false
        };
        //walk the huffman tree while reading from bitstream and set the arrays of fields/indices
        //each field is an object with name and dt_field
        walk(bs, fieldpath);
        /*
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
    	*/
        return result;
    }
    /**
     * Walks the huffman tree 
     **/
    function walk(bs, fp) {
        var count = 0;
        var root = fp.huf;
        var node = root;
        while (!fp.finished) {
            count += 1;
            if (bs.readBoolean()) {
                //go right
                var right = node.right;
                if (right.isLeaf()) {
                    node = root;
                    //perform a fieldpath operation
                    fieldpathOperations[right.value].op(bs, fp);
                    if (!fp.finished) {
                        addField(fp);
                    }
                    count = 0;
                }
                else {
                    //not a leaf, continue the walk
                    node = right;
                }
            }
            else {
                //go left
                var left = node.left;
                if (left.isLeaf()) {
                    node = root;
                    //perform a fieldpath operation
                    fieldpathOperations[left.value].op(bs, fp);
                    if (!fp.finished) {
                        addField(fp);
                    }
                    count = 0;
                }
                else {
                    node = right;
                }
            }
        }
    }
    // Adds a field based on the current index
    function addField(fieldpath) {
        /*
        cDt: = fp.parent
        var name string
        var i int
        if debugLevel >= 6 {
            var path string
            for i: = 0;
            i < len(fp.index) - 1;
            i++{
                path += strconv.Itoa(int(fp.index[i])) + "/"
            }
            _debugfl(6, "Adding field with path: %s%d", path, fp.index[len(fp.index) - 1])
        }
        for i = 0;i < len(fp.index) - 1;i++{
            if cDt.Properties[fp.index[i]].Table != nil {
                cDt = cDt.Properties[fp.index[i]].Table
                name += cDt.Name + "."
            }
            else {
                // Hint:
                // If this panics, the property in question migh have a type that doesn't premit automatic array deduction (e.g. no CUtlVector prefix, or [] suffix).
                // Adjust the type manualy in property_serializers.go
                _panicf("expected table in fp properties: %v, %v", cDt.Properties[fp.index[i]].Field.Name, cDt.Properties[fp.index[i]].Field.Type)
            }
        }
        fp.fields = append(fp.fields, & fieldpath_field {
            name + cDt.Properties[fp.index[i]].Field.Name, cDt.Properties[fp.index[i]].Field
        })
        */
    }
    // Global fieldpath lookup array
    var fieldpathOperations = [
        {
            name: "PlusOne",
            op: PlusOne,
            weight: 36271
            },
        {
            name: "PlusTwo",
            op: PlusTwo,
            weight: 10334
            },
        {
            name: "PlusThree",
            op: PlusThree,
            weight: 1375
            },
        {
            name: "PlusFour",
            op: PlusFour,
            weight: 646
            },
        {
            name: "PlusN",
            op: PlusN,
            weight: 4128
            },
        {
            name: "PushOneLeftDeltaZeroRightZero",
            op: PushOneLeftDeltaZeroRightZero,
            weight: 35
            },
        {
            name: "PushOneLeftDeltaZeroRightNonZero",
            op: PushOneLeftDeltaZeroRightNonZero,
            weight: 3
            },
        {
            name: "PushOneLeftDeltaOneRightZero",
            op: PushOneLeftDeltaOneRightZero,
            weight: 521
            },
        {
            name: "PushOneLeftDeltaOneRightNonZero",
            op: PushOneLeftDeltaOneRightNonZero,
            weight: 2942
            },
        {
            name: "PushOneLeftDeltaNRightZero",
            op: PushOneLeftDeltaNRightZero,
            weight: 560
            },
        {
            name: "PushOneLeftDeltaNRightNonZero",
            op: PushOneLeftDeltaNRightNonZero,
            weight: 471
            },
        {
            name: "PushOneLeftDeltaNRightNonZeroPack6Bits",
            op: PushOneLeftDeltaNRightNonZeroPack6Bits,
            weight: 10530
            },
        {
            name: "PushOneLeftDeltaNRightNonZeroPack8Bits",
            op: PushOneLeftDeltaNRightNonZeroPack8Bits,
            weight: 251
            },
        {
            name: "PushTwoLeftDeltaZero",
            op: PushTwoLeftDeltaZero,
            weight: 0
            },
        {
            name: "PushTwoPack5LeftDeltaZero",
            op: PushTwoPack5LeftDeltaZero,
            weight: 0
            },
        {
            name: "PushThreeLeftDeltaZero",
            op: PushThreeLeftDeltaZero,
            weight: 0
            },
        {
            name: "PushThreePack5LeftDeltaZero",
            op: PushThreePack5LeftDeltaZero,
            weight: 0
            },
        {
            name: "PushTwoLeftDeltaOne",
            op: PushTwoLeftDeltaOne,
            weight: 0
            },
        {
            name: "PushTwoPack5LeftDeltaOne",
            op: PushTwoPack5LeftDeltaOne,
            weight: 0
            },
        {
            name: "PushThreeLeftDeltaOne",
            op: PushThreeLeftDeltaOne,
            weight: 0
            },
        {
            name: "PushThreePack5LeftDeltaOne",
            op: PushThreePack5LeftDeltaOne,
            weight: 0
            },
        {
            name: "PushTwoLeftDeltaN",
            op: PushTwoLeftDeltaN,
            weight: 0
            },
        {
            name: "PushTwoPack5LeftDeltaN",
            op: PushTwoPack5LeftDeltaN,
            weight: 0
            },
        {
            name: "PushThreeLeftDeltaN",
            op: PushThreeLeftDeltaN,
            weight: 0
            },
        {
            name: "PushThreePack5LeftDeltaN",
            op: PushThreePack5LeftDeltaN,
            weight: 0
            },
        {
            name: "PushN",
            op: PushN,
            weight: 0
            },
        {
            name: "PushNAndNonTopological",
            op: PushNAndNonTopological,
            weight: 310
            },
        {
            name: "PopOnePlusOne",
            op: PopOnePlusOne,
            weight: 2
            },
        {
            name: "PopOnePlusN",
            op: PopOnePlusN,
            weight: 0
            },
        {
            name: "PopAllButOnePlusOne",
            op: PopAllButOnePlusOne,
            weight: 1837
            },
        {
            name: "PopAllButOnePlusN",
            op: PopAllButOnePlusN,
            weight: 149
            },
        {
            name: "PopAllButOnePlusNPack3Bits",
            op: PopAllButOnePlusNPack3Bits,
            weight: 300
            },
        {
            name: "PopAllButOnePlusNPack6Bits",
            op: PopAllButOnePlusNPack6Bits,
            weight: 634
            },
        {
            name: "PopNPlusOne",
            op: PopNPlusOne,
            weight: 0
            },
        {
            name: "PopNPlusN",
            op: PopNPlusN,
            weight: 0
            },
        {
            name: "PopNAndNonTopographical",
            op: PopNAndNonTopographical,
            weight: 1
            },
        {
            name: "NonTopoComplex",
            op: NonTopoComplex,
            weight: 76
            },
        {
            name: "NonTopoPenultimatePlusOne",
            op: NonTopoPenultimatePlusOne,
            weight: 271
            },
        {
            name: "NonTopoComplexPack4Bits",
            op: NonTopoComplexPack4Bits,
            weight: 99
            },
        {
            name: "FieldPathEncodeFinish",
            op: FieldPathEncodeFinish,
            weight: 25474
            }
];
    //build a huffman tree from the operation weights
    //these are always the same, so can reuse the tree?
    var huf = Huffman(fieldpathOperations.map(function(f) {
        return f.weight;
    }));

    function PlusOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 1
    }

    function PlusTwo(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 2
    }

    function PlusThree(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 3
    }

    function PlusFour(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 4
    }

    function PlusN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVarFP()) + 5
    }

    function PushOneLeftDeltaZeroRightZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, 0)
    }

    function PushOneLeftDeltaZeroRightNonZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushOneLeftDeltaOneRightZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 1
        fp.index = append(fp.index, 0)
    }

    function PushOneLeftDeltaOneRightNonZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += 1
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushOneLeftDeltaNRightZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVarFP())
        fp.index = append(fp.index, 0)
    }

    function PushOneLeftDeltaNRightNonZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVarFP()) + 2
        fp.index = append(fp.index, int32(r.readUBitVarFP()) + 1)
    }

    function PushOneLeftDeltaNRightNonZeroPack6Bits(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readBits(3)) + 2
        fp.index = append(fp.index, int32(r.readBits(3)) + 1)
    }

    function PushOneLeftDeltaNRightNonZeroPack8Bits(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readBits(4)) + 2
        fp.index = append(fp.index, int32(r.readBits(4)) + 1)
    }

    function PushTwoLeftDeltaZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, 0)
        fp.index = append(fp.index, 0)
    }

    function PushTwoLeftDeltaOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1]++
            fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushTwoLeftDeltaN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVar()) + 2
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushTwoPack5LeftDeltaZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushTwoPack5LeftDeltaOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1]++
            fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushTwoPack5LeftDeltaN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVar()) + 2
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushThreeLeftDeltaZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushThreeLeftDeltaOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1]++
            fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushThreeLeftDeltaN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVar()) + 2
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
        fp.index = append(fp.index, int32(r.readUBitVarFP()))
    }

    function PushThreePack5LeftDeltaZero(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushThreePack5LeftDeltaOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1]++
            fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushThreePack5LeftDeltaN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 1] += int32(r.readUBitVar()) + 2
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
        fp.index = append(fp.index, int32(r.readBits(5)))
    }

    function PushN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        n: = int(r.readUBitVar())
        fp.index[len(fp.index) - 1] += int32(r.readUBitVar())
        for i: = 0;
        i < n;
        i++{
            fp.index = append(fp.index, int32(r.readUBitVarFP()))
        }
    }

    function PushNAndNonTopological(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        for i: = 0;
        i < len(fp.index);
        i++{
            if r.readBoolean() {
                fp.index[i] += r.readVarInt32() + 1
            }
        }
        count: = int(r.readUBitVar())
        for j: = 0;
        j < count;
        j++{
            fp.index = append(fp.index, int32(r.readUBitVarFP()))
        }
    }

    function PopOnePlusOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: len(fp.index) - 1]
        fp.index[len(fp.index) - 1] += 1
    }

    function PopOnePlusN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: len(fp.index) - 1]
        fp.index[len(fp.index) - 1] += int32(r.readUBitVarFP()) + 1
    }

    function PopAllButOnePlusOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: 1]
        fp.index[len(fp.index) - 1] += 1
    }

    function PopAllButOnePlusN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: 1]
        fp.index[len(fp.index) - 1] += int32(r.readUBitVarFP()) + 1
    }

    function PopAllButOnePlusNPackN(bs, fp) {
        _panicf("Name: %s", fp.parent.Name)
    }

    function PopAllButOnePlusNPack3Bits(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: 1]
        fp.index[len(fp.index) - 1] += int32(r.readBits(3)) + 1
    }

    function PopAllButOnePlusNPack6Bits(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: 1]
        fp.index[len(fp.index) - 1] += int32(r.readBits(6)) + 1
    }

    function PopNPlusOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: len(fp.index) - (int(r.readUBitVarFP()))]
        fp.index[len(fp.index) - 1] += 1
    }

    function PopNPlusN(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: len(fp.index) - (int(r.readUBitVarFP()))]
        fp.index[len(fp.index) - 1] += r.readVarInt32()
    }

    function PopNAndNonTopographical(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index = fp.index[: len(fp.index) - (int(r.readUBitVarFP()))]
        for i: = 0;
        i < len(fp.index);
        i++{
            if r.readBoolean() {
                fp.index[i] += r.readVarInt32()
            }
        }
    }

    function NonTopoComplex(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        for i: = 0;
        i < len(fp.index);
        i++{
            if r.readBoolean() {
                fp.index[i] += r.readVarInt32()
            }
        }
    }

    function NonTopoPenultimatePlusOne(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.index[len(fp.index) - 2] += 1
    }

    function NonTopoComplexPack4Bits(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        for i: = 0;
        i < len(fp.index);
        i++{
            if r.readBoolean() {
                fp.index[i] += int32(r.readBits(4)) - 7
            }
        }
    }

    function FieldPathEncodeFinish(bs, fp) {
        _debugfl(10, "Name: %s", fp.parent.Name)
        fp.finished = true
    }
}