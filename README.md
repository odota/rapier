# rapier
A JavaScript Dota 2 (Source 2) replay parsing library

Rapier is a Dota 2 replay parsing library supporting Source 2 replays written in JavaScript.

It will throw (exceptions) if incorrectly used. :)

Why JavaScript?
* Potential for in-browser parsing (isomorphic)
* No other JS replay parsing library
* Makes the YASP stack 100% JavaScript

API
----
Rapier is designed to offer a very simple API.
Users simply attach event listeners with the names of the protobuf messages they're interested in.
Properties such as string tables, game event descriptors, and id->string mappings are exposed to allow the user to interpret the message.
See the examples.

Examples
----
Examples of server and client side parsing can be found in `examples/`

Usage
----
* Node.js: `npm install rapier`, then `var Parser = require('rapier')`
* Browser: `<script src="./build/rapier.js"></script>` (you can grab the file and host it anywhere)

TODO:
- [ ] Entities
- [ ] npm release