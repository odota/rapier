# rapier
A JavaScript Dota 2 (Source 2) replay parsing library.

It throws (exceptions) if incorrectly used. :)

[![npm version](https://badge.fury.io/js/rapier.svg)](http://badge.fury.io/js/rapier)

Why JavaScript?
----
* Can be used for both server-side and in-browser parsing (isomorphic design)
* No JS replay parsing library yet

Notes
----
* Rapier does not handle entities yet.  Everything else (of interest) should be supported.
* Performance of the library is relatively poor compared to other implementations.  Part of this is likely due to lack of optimization and partly due to JS lacking types and slow bitwise operations.  In exchange, you can develop and run your application fully in JavaScript.
* This library is not currently in production use and is not actively maintained.

API
----
* Rapier is designed to offer a very simple API.
* Users simply attach event listeners with the names of the protobuf messages they're interested in.
* Properties such as string tables, game event descriptors, and id->string mappings are exposed to allow the user to interpret the message.
* Event names are listed under "dems" and "packets" in `build/types.json`, or refer to the original .proto files in `proto`.

Event Overview
----
* DEM messages.  The basic building block of the replay.
    * CDemoPacket, CDemoFullPacket, CDemoSignonPacket.  These messages contain one or more packets.
        * Packets.  Contain most of the interesting data in the replay.  
            * User Messages.  These include all chat.
            * Dota User Messages.  These include objectives, map pings, and actions.
            * Game Events.  These come in several flavors and their content/structure are interpreted by using the game event descriptors (available to the user)
                * Combat Log.  Combat log entries are a type of game event.  Some fields require the use of string tables (available to the user) to translate a number to a useful string ("npc_dota_hero_furion").
            * Packet Entities.
    * CDemoFileInfo.  This includes an end-of-game summary.
    * CDemoSpawnGroup.
    * CDemoSaveGame.

Usage
----
* Node.js: `npm install rapier`
* Browser: `<script src="./build/rapier.js"></script>` (you can grab the file and host it anywhere)

Examples
----
Examples of server and client side parsing can be found in `examples`
