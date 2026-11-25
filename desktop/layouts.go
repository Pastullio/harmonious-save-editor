package main

// The game tables DryDock reads, each with the layout stamp (template GUID) its reader was written for. A game update
// that changes a table's fields changes its stamp, and the reader then leaves the table alone rather than read it
// wrongly. The Report checks every one and puts the changed tables in its zip, so the reader can be brought up to
// date from the file itself (owner 2026-11-25, after the game's 7.15 patch changed the building table).
var knownLayouts = []struct {
	file  string // the end of the file's path in the archives
	guid  uint64
	also  []uint64 // other stamps the reader has been checked against
	feeds string   // what goes missing in DryDock when it changes
}{
	{"metadata/reality/tables/nms_reality_gcproducttable.mbin", 0xD648571CB22CFD4B, nil, "item names and icons"},
	{"metadata/reality/tables/nms_basepartproducts.mbin", 0xD648571CB22CFD4B, nil, "base part names"},
	{"metadata/reality/tables/nms_modularcustomisationproducts.mbin", 0xD648571CB22CFD4B, nil, "ship and staff part names"},
	{"metadata/reality/tables/nms_reality_gcsubstancetable.mbin", 0x7E06AA18E2BF796D, nil, "substance names"},
	{"metadata/reality/tables/nms_reality_gctechnologytable.mbin", 0x9373B1DC2FEEE859, nil, "technology names and where it fits"},
	{"metadata/reality/tables/nms_reality_gcproceduraltechnologytable.mbin", 0x63A7DEF7997212ED, nil, "upgrade names"},
	{"language/nms_loc1_english.mbin", 0xDE95E805E17A7B69, nil, "every name (the game's English text)"},
	{"metadata/reality/tables/nms_dialog_gcalienspeechtable.mbin", 0x29A23A2F80FBE6D8, nil, "words on the Knowledge page"},
	{"metadata/reality/tables/frigatetraittable.mbin", 0x59E8152F3D9078A8, nil, "frigate traits"},
	{"metadata/reality/tables/settlementperkstable.mbin", 0x34625E03A674E543, nil, "settlement perks"},
	{"metadata/reality/tables/historicalseasondatatable.mbin", 0xF917FBD15953731A, nil, "expedition names on the Rewards page"},
	{"metadata/reality/tables/unlockableseasonrewards.mbin", 0x5D906A07E9EA8A9F, nil, "expedition rewards"},
	{"metadata/reality/tables/unlockabletwitchrewards.mbin", 0xDAE66604A5D6F5D4, nil, "Twitch rewards"},
	{"metadata/reality/tables/unlockableplatformrewards.mbin", 0x6813221B24CD0086, nil, "platform rewards"},
	{"metadata/gamestate/stats/leveledstatstable.mbin", 0x8C5EEFF51B0E1C86, nil, "rank names on the Standing page"},
	{"metadata/simulation/solarsystem/biomes/biomelistperstartype.mbin", 0x816993EB69267DD2, nil, "biome odds on the Coordinates page"},
	{"metadata/simulation/ecosystem/creaturefilenametable.mbin", creatureFilenamesGUID, nil, "companion models"},
	{"metadata/simulation/ecosystem/creaturedatatable.mbin", 0x37D55099B13B9F9C, nil, "companion battle types"},
	{"metadata/gamestate/playerdata/charactercustomisationdescriptorgroupsdata.mbin", 0x6E1D4A06924711BB, nil, "the traveller's model and built ships' parts"},
	{"metadata/reality/tables/basebuildingobjectstable.mbin", objectsTableGUIDs[0], objectsTableGUIDs[1:], "the real sizes of corvette parts in the hologram"},
	{"metadata/reality/tables/basebuildingpartstable.mbin", partsTableGUIDs[0], partsTableGUIDs[1:], "the real sizes of corvette parts in the hologram"},
	{"models/common/spacecraft/fighters/fighter_proc.scene.mbin", 0xAD96A863591F02D8, nil, "every 3D model (scenes)"},
	{"models/common/spacecraft/fighters/accessories/acca.geometry.mbin", 0xDA1F6CA99ADEF6A6, nil, "every 3D model (geometry)"},
	{"models/common/spacecraft/fighters/accessories/acca.geometry.data.mbin", 0xCCB46895A8B36313, nil, "every 3D model (geometry data)"},
}
