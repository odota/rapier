# rapier
A JavaScript Dota 2 (Source 2) replay parsing library.

Rapier is a Dota 2 replay parsing library supporting Source 2 replays written in JavaScript.

It will throw (exceptions) if incorrectly used. :)

Why JavaScript?
----
* Potential for in-browser parsing (isomorphic design)
* No JS replay parsing library yet
* Makes the YASP stack 100% JavaScript

API
----
* Rapier is designed to offer a very simple API.
* Users simply attach event listeners with the names of the protobuf messages they're interested in.
* Properties such as string tables, game event descriptors, and id->string mappings are exposed to allow the user to interpret the message.

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
    * CDemoSpawnGroups.
    * CDemoSaveGames.

Usage
----
* Node.js: `npm install rapier`
* Browser: `<script src="./build/rapier.js"></script>` (you can grab the file and host it anywhere)

Examples
----
Examples of server and client side parsing can be found in `examples`
