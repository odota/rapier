var Parser = require('../Parser');
//parser accepts a stream or buffer, returns an eventemitter
var p = new Parser(process.stdin);
//var p = new Parser(require('fs').readFileSync('./testfiles/1698148651_source2.dem'));
//PROPERTIES
//the parser exposes these properties in order to help you interpret the content of the messages
var types = p.types;
var gameEventDescriptors = p.gameEventDescriptors;
var stringTables = p.stringTables;
var entities = p.entities;
//EVENTS
//add an event listener with the name of the protobuf message in order to listen for it
//full dem/packet listing is in build/types.json, or user can refer to original .proto files
//WARNING: not every type listed is actually in the replay--it's automatically generated from enums in .protos!
//-
//game epilogue
p.on("CDemoFileInfo", function(data) {
    console.log(data);
});
//all chat
p.on("CUserMessageSayText2", function(data) {
    console.log(data);
});
//chat wheel
p.on("CDOTAUserMsg_ChatWheel", function(data){
    data.chat_message = types["EDOTAChatWheelMessage"][data.chat_message];
    //console.log(data);
});
//overhead events
p.on("CDOTAUserMsg_OverheadEvent", function(data){
    //console.log(data);
});
//map pings
p.on("CDOTAUserMsg_LocationPing", function(data) {
    //console.log(data);
});
//objectives
p.on("CDOTAUserMsg_ChatEvent", function(data) {
    //look up the type with DOTA_CHAT_MESSAGE
    data.name = types.DOTA_CHAT_MESSAGE[data.type];
    //console.log(data);
});
//gameevents
p.on("CMsgSource1LegacyGameEvent", function(data) {
    //get the event name from descriptor
    data.event_name = gameEventDescriptors[data.eventid].name;
    //use the descriptor to read the gameevent data and build a gameevent object
    var gameEvent = {};
    data.keys.forEach(function(k, i) {
        //each k is an object with an index and some values (one for each primitive, only one is populated)
        //we want to get the name of the property and which value to read based on the descriptor for this eventid
        var key = gameEventDescriptors[data.eventid].keys[i].name;
        var index = gameEventDescriptors[data.eventid].keys[i].type;
        //get the value of the key in object for that type
        var value = k[Object.keys(k)[index]];
        //populate the gameevent
        gameEvent[key] = value;
    });
    //combat log is a type of gameevent
    //gameevent types are not listed in the .protos, but are defined in the GameEventDescriptors contained within a replay
    //therefore we don't know what game event types are available or what data they contain until runtime 
    if (data.event_name === "dota_combatlog") {
        var cle = gameEvent;
        //look up the type with DOTA_COMBATLOG_TYPES
        cle.name = types.DOTA_COMBATLOG_TYPES[cle.type];
        //translate the entries using stringtable
        var combatLogNames = stringTables.tablesByName["CombatLogNames"];
        //translate the following fields with the stringtable
        cle.sourcename = combatLogNames.string_data[cle.sourcename].key;
        cle.targetname = combatLogNames.string_data[cle.targetname].key;
        cle.attackername = combatLogNames.string_data[cle.attackername].key;
        cle.inflictorname = combatLogNames.string_data[cle.inflictorname].key;
        cle.targetsourcename = combatLogNames.string_data[cle.targetsourcename].key;
        //value needs a translation for certain types (for example, purchases), other times it's just an integer
        cle.valuename = combatLogNames[cle.value] ? combatLogNames[cle.value].key : null;
        if (cle.type === 14) {
            //console.log(cle);
        }
    }
});
//every tick
/*
p.on("CNETMsg_Tick", function(data) {
    //console.log(data);
});
*/
//console data (includes some stun/slow data and damage breakdown by target/ability)
/*
p.on("CUserMessageTextMsg", function(data) {
    //console.log(data);
});
*/
//user actions
/*
p.on("CDOTAUserMsg_SpectatorPlayerUnitOrders", function(data) {
    console.log(data);
});
*/
//everything
//each event is called with the protobuf message contents and the name of the message
/*
p.on("*", function(data, proto_name) {
    //console.log(data);
    counts[proto_name] = counts[proto_name] ? counts[proto_name] + 1 : 1;
});
*/

var counts = {};
console.time('parse');
//start takes a callback function that is called when the parse completes
p.start(function(err) {
    if (err) {
        console.error(err);
    }
    console.error(counts);
    console.timeEnd('parse');
});
