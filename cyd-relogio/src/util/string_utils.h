#pragma once

#include <Arduino.h>

// Returns a copy of `input` with the first letter of each word capitalised.
String toTitleCase( String input );

// Returns true if `input` loosely matches `target` (case-insensitive prefix/contains).
bool fuzzyMatch( String input, String target );


// Returns a copy of `input` with Portuguese/Latin accents removed (UTF-8 -> ASCII),
// e.g. "Brasília" -> "Brasilia". The display fonts have no accented glyphs.
String semAcentos( const String &input );
