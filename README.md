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

Examples
----
Examples of server and client side parsing can be found in `examples/`

TODO:
-[ ] Entities
