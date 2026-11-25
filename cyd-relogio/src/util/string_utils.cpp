#include "string_utils.h"

String toTitleCase( String input ) {
    input.toLowerCase();
    if ( input.length() > 0 ) {
        input[ 0 ] = toupper( input[ 0 ] );
    }
    for ( int i = 1; i < input.length(); i++ ) {
        if ( input[ i - 1 ] == ' ' ) {
            input[ i ] = toupper( input[ i ] );
        }
    }
    return input;
}

bool fuzzyMatch( String input, String target ) {
    String inp = input;
    String tgt = target;
    inp.toLowerCase();
    tgt.toLowerCase();
    if ( inp == tgt ) {
        return true;
    }
    if ( tgt.indexOf( inp ) >= 0 ) {
        return true;
    }
    if ( inp.length() >= 3 && tgt.startsWith( inp ) ) {
        return true;
    }
    return false;
}


String semAcentos( const String &input ) {
    // Latin-1 supplement (U+00C0..U+00FF) encoded in UTF-8 as 0xC3 0x80..0xBF
    static const char *map = "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";
    String out;
    out.reserve( input.length() );
    for ( unsigned int i = 0; i < input.length(); i++ ) {
        uint8_t c = ( uint8_t )input[ i ];
        if ( c == 0xC3 && i + 1 < input.length() ) {
            uint8_t n = ( uint8_t )input[ i + 1 ];
            if ( n >= 0x80 && n <= 0xBF ) {
                out += map[ n - 0x80 ];
                i++;
                continue;
            }
        }
        if ( c < 0x80 ) {
            out += ( char )c;
        }
    }
    return out;
}
