var BitStream = require('./BitStream');
var snappy = require('./snappy');
module.exports = function(p){
     //string tables may mutate over the lifetime of the replay.
    //Therefore we listen for create/update events and modify the table as needed.
    //p.on("CDemoStringTables", readCDemoStringTables);
    p.on("CSVCMsg_CreateStringTable", readCreateStringTable);
    p.on("CSVCMsg_UpdateStringTable", readUpdateStringTable);
    
    
    function readCDemoStringTables(data) {
        //rather than processing when we read this demo message, we want to create when we read the packet CSVCMsg_CreateStringTable
        //this packet is just emitted as a state dump at intervals
        return;
    }

    function readCreateStringTable(msg) {
        //create a stringtable
        //console.error(data);
        //extract the native buffer from the string_data ByteBuffer, with the offset removed
        var buf = new Buffer(msg.string_data.toBuffer());
        if (msg.data_compressed) {
            //decompress the string data with snappy
            //early source 2 replays may use LZSS, we can detect this by reading the first four bytes of buffer
            buf = snappy.uncompressSync(buf);
        }
        //pass the buffer and parse string table data from it
        var items = parseStringTableData(buf, msg.num_entries, msg.user_data_fixed_size, msg.user_data_size);
        //console.error(items);
        //remove the buf and replace with items, which is a decoded version of it
        msg.string_data = {};
        // Insert the items into the table as an object
        items.forEach(function(it) {
            msg.string_data[it.index] = it;
        });
        p.stringTables.tablesByName[msg.name] = msg;
        p.stringTables.tables.push(msg);
        // Apply the updates to baseline state
        if (msg.name === "instancebaseline") {
            p.updateInstanceBaseline();
        }
    }

    function readUpdateStringTable(msg) {
        //update a string table
        //retrieve table by id
        var table = p.stringTables.tables[msg.table_id];
        //extract native buffer
        var buf = new Buffer(msg.string_data.toBuffer());
        if (table) {
            var items = parseStringTableData(buf, msg.num_changed_entries, table.user_data_fixed_size, table.user_data_size);
            var string_data = table.string_data;
            items.forEach(function(it) {
                //console.error(it);
                if (!string_data[it.index]) {
                    //we don't have this item in the string table yet, add it
                    string_data[it.index] = it;
                }
                else {
                    //we're updating an existing item
                    //only update key if the new key is not blank
                    if (it.key) {
                        //console.error("updating key %s->%s at index %s on %s, id %s", string_data[it.index].key, it.key, it.index, table.name, data.table_id);
                        string_data[it.index].key = it.key;
                        //string_data[it.index].key = [].concat(string_data[it.index].key).concat(it.key);
                    }
                    //only update value if the new item has a nonempty value buffer
                    if (it.value.length) {
                        //console.error("updating value length %s->%s at index %s on %s", string_data[it.index].value.length, it.value.length, it.index, table.name);
                        string_data[it.index].value = it.value;
                    }
                }
            });
            // Apply the updates to baseline state
            if (msg.name === "instancebaseline") {
                p.updateInstanceBaseline();
            }
        }
        else {
            console.err("string table %s doesn't exist!", msg.table_id);
            throw "string table doesn't exist!";
        }
    }
    /**
     * Parses a buffer of string table data and returns an array of decoded items
     **/
    function parseStringTableData(buf, num_entries, userDataFixedSize, userDataSize) {
        // Some tables have no data
        if (!buf.length) {
            return [];
        }
        var items = [];
        var bs = new BitStream(buf);
        // Start with an index of -1.
        // If the first item is at index 0 it will use a incr operation.
        var index = -1;
        var STRINGTABLE_KEY_HISTORY_SIZE = 32;
        // Maintain a list of key history
        // each entry is a string
        var keyHistory = [];
        // Loop through entries in the data structure
        // Each entry is a tuple consisting of {index, key, value}
        // Index can either be incremented from the previous position or overwritten with a given entry.
        // Key may be omitted (will be represented here as "")
        // Value may be omitted
        for (var i = 0; i < num_entries; i++) {
            var key = null;
            var value = new Buffer(0);
            // Read a boolean to determine whether the operation is an increment or
            // has a fixed index position. A fixed index position of zero should be
            // the last data in the buffer, and indicates that all data has been read.
            var incr = bs.readBoolean();
            if (incr) {
                index += 1;
            }
            else {
                index = bs.readVarUInt() + 1;
            }
            // Some values have keys, some don't.
            var hasKey = bs.readBoolean();
            if (hasKey) {
                // Some entries use reference a position in the key history for
                // part of the key. If referencing the history, read the position
                // and size from the buffer, then use those to build the string
                // combined with an extra string read (null terminated).
                // Alternatively, just read the string.
                var useHistory = bs.readBoolean();
                if (useHistory) {
                    var pos = bs.readBits(5);
                    var size = bs.readBits(5);
                    if (pos >= keyHistory.length) {
                        //history doesn't have this position, just read
                        key = bs.readNullTerminatedString();
                    }
                    else {
                        var s = keyHistory[pos];
                        if (size > s.length) {
                            //our target size is longer than the key stored in history
                            //pad the remaining size with a null terminated string from stream
                            key = (s + bs.readNullTerminatedString());
                        }
                        else {
                            //we only want a piece of the historical string, slice it out and read the null terminator
                            key = s.slice(0, size) + bs.readNullTerminatedString();
                        }
                    }
                }
                else {
                    //don't use the history, just read the string
                    key = bs.readNullTerminatedString();
                }
                keyHistory.push(key);
                if (keyHistory.length > STRINGTABLE_KEY_HISTORY_SIZE) {
                    //drop the oldest key if we hit the cap
                    keyHistory.shift();
                }
            }
            // Some entries have a value.
            var hasValue = bs.readBoolean();
            if (hasValue) {
                // Values can be either fixed size (with a size specified in
                // bits during table creation, or have a variable size with
                // a 14-bit prefixed size.
                if (userDataFixedSize) {
                    value = bs.readBuffer(userDataSize);
                }
                else {
                    var valueSize = bs.readBits(14);
                    //XXX mysterious 3 bits of data?
                    bs.readBits(3);
                    value = bs.readBuffer(valueSize * 8);
                }
            }
            items.push({
                index: index,
                key: key,
                value: value
            });
        }
        //console.error(keyHistory, items, num_entries);
        return items;
    }
}