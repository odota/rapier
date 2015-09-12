#!/bin/sh
cd `dirname "$0"`
pushd proto
rm *.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/base_gcmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/c_peer2peer_netmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/connectionless_netmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/demo.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_broadcastmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_clientmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_commonmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_gcmessages_client.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_gcmessages_client_fantasy.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_gcmessages_common.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_gcmessages_server.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_modifiers.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/dota_usermessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/econ_gcmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/gameevents.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/gcsdk_gcmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/gcsystemmsgs.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/netmessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/network_connection.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/networkbasetypes.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/networksystem_protomessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/rendermessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/steamdatagram_messages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/steammessages.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/steammessages_cloud.steamworkssdk.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/steammessages_oauth.steamworkssdk.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/steammessages_unified_base.steamworkssdk.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/te.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/toolevents.proto
wget https://raw.githubusercontent.com/SteamDatabase/GameTracking/master/Protobufs/dota/usermessages.proto
p