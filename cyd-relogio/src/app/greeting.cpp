#include "greeting.h"

#include <TFT_eSPI.h>
#include <Preferences.h>
#include <time.h>

#include "../data/app_state.h"
#include "../ui/screens.h"
#include "../ui/theme.h"
#include "../util/constants.h"

// ---------------------------------------------------------------------------
// Externs — defined in main.cpp
// ---------------------------------------------------------------------------
extern TFT_eSPI    tft;
extern ScreenState currentState;
extern bool        isWhiteTheme;
extern int         themeMode;
extern bool        keyboardNumbers;
extern bool        keyboardShift;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
static String userName;
static String nameInput;          // texto sendo digitado na tela de edição
static int    lastPeriod = -1;    // 0 = dia, 1 = tarde, 2 = noite

constexpr int NAME_MAX_LEN = 16;

// Área da saudação na coluna da esquerda (entre a umidade e a linha da previsão)
constexpr int GREET_X = 0, GREET_Y = 78, GREET_W = 155, GREET_H = 40;

void greetingInit() {
    Preferences p;
    if ( p.begin( "user", true ) ) {
        userName = p.getString( "name", "" );
        p.end();
    }
}

String greetingGetName() {
    return userName;
}

static void saveName() {
    Preferences p;
    if ( p.begin( "user", false ) ) {
        p.putString( "name", userName );
        p.end();
    }
}

static int periodForHour( int hour ) {
    if ( hour >= 5 && hour < 12 ) {
        return 0;
    }
    if ( hour >= 12 && hour < 18 ) {
        return 1;
    }
    return 2;
}

void drawGreeting() {
    struct tm ti;
    if ( !getLocalTime( &ti, 0 ) ) {
        return;
    }
    int period = periodForHour( ti.tm_hour );
    lastPeriod = period;

    static const char *GREETINGS[ 3 ] = {"Bom dia", "Boa tarde", "Boa noite"};
    uint16_t bg = getBgColor();
    uint16_t accent = TFT_SKYBLUE;
    if ( themeMode == THEME_BLUE ) {
        accent = TFT_YELLOW;
    }
    else if ( themeMode == THEME_YELLOW ) {
        accent = TFT_BLACK;
    }

    tft.fillRect( GREET_X, GREET_Y, GREET_W, GREET_H, bg );
    tft.setTextDatum( TL_DATUM );

    tft.setFreeFont( &FreeSans9pt7b );
    tft.setTextColor( getTextColor(), bg );
    if ( userName.length() == 0 ) {
        tft.drawString( String( GREETINGS[ period ] ) + "!", 5, GREET_Y + 10 );
        tft.setFreeFont( NULL );
        return;
    }
    tft.drawString( String( GREETINGS[ period ] ) + ",", 5, GREET_Y + 2 );

    // Nome em negrito na linha de baixo, encurtado se não couber
    tft.setFreeFont( &FreeSansBold9pt7b );
    tft.setTextColor( accent, bg );
    String name = userName;
    while ( name.length() > 1 && tft.textWidth( name + "!" ) > GREET_W - 8 ) {
        name.remove( name.length() - 1 );
    }
    tft.drawString( name + "!", 5, GREET_Y + 21 );
    tft.setFreeFont( NULL );
}

void drawGreetingIfPeriodChanged() {
    struct tm ti;
    if ( !getLocalTime( &ti, 0 ) ) {
        return;
    }
    if ( periodForHour( ti.tm_hour ) != lastPeriod ) {
        drawGreeting();
    }
}

// ---------------------------------------------------------------------------
// Ajustes > Nome — teclado no mesmo desenho do teclado de cidade
// ---------------------------------------------------------------------------
static const char *keyboardRows( int r ) {
    static const char *letters[ 3 ] = {"qwertyuiop", "asdfghjkl", "zxcvbnm"};
    static const char *numbers[ 3 ] = {"1234567890", "!@#$%^&*(/", ")-_+=.,?"};
    return keyboardNumbers ? numbers[ r ] : letters[ r ];
}

void drawNameInputScreen() {
    uint16_t line = isWhiteTheme ? TFT_DARKGREY : TFT_WHITE;
    tft.fillScreen( getBgColor() );
    tft.setTextColor( getTextColor() );
    tft.setTextDatum( MC_DATUM );
    tft.setFreeFont( &FreeSansBold12pt7b );
    tft.drawString( "Seu nome", 160, 20 );

    tft.drawRect( 10, 40, 300, 30, isWhiteTheme ? TFT_BLACK : TFT_WHITE );
    tft.setFreeFont( &FreeSans9pt7b );
    tft.setTextDatum( ML_DATUM );
    tft.drawString( nameInput, 20, 55 );

    tft.setTextDatum( MC_DATUM );
    for ( int r = 0; r < 3; r++ ) {
        const char *row = keyboardRows( r );
        for ( int i = 0; i < ( int )strlen( row ); i++ ) {
            int btnX = i * 29 + 2;
            int btnY = 80 + r * 30;
            tft.drawRect( btnX, btnY, 26, 26, line );
            char ch = row[ i ];
            if ( keyboardShift && !keyboardNumbers ) {
                ch = toupper( ch );
            }
            tft.drawString( String( ch ), btnX + 13, btnY + 15 );
        }
    }

    tft.drawRect( 2, 170, 316, 25, line );
    tft.drawString( "Espaco", 160, 183 );

    const int bw = 64, by = 198, bh = 35;
    tft.setTextColor( isWhiteTheme ? TFT_BLACK : TFT_WHITE );
    tft.drawRect( 0 * bw + 2, by, bw - 4, bh, line );
    tft.drawString( "Shift", 0 * bw + bw / 2, by + 18 );
    tft.drawRect( 1 * bw + 2, by, bw - 4, bh, line );
    tft.drawString( "123", 1 * bw + bw / 2, by + 18 );
    tft.drawRect( 2 * bw + 2, by, bw - 4, bh, line );
    tft.drawString( "Apaga", 2 * bw + bw / 2, by + 18 );

    tft.setTextColor( TFT_GREEN );
    tft.drawRect( 3 * bw + 2, by, bw - 4, bh, TFT_GREEN );
    tft.drawString( "SALVAR", 3 * bw + bw / 2, by + 18 );

    tft.setTextColor( TFT_ORANGE );
    tft.drawRect( 4 * bw + 2, by, bw - 4, bh, TFT_ORANGE );
    tft.drawString( "VOLTAR", 4 * bw + bw / 2, by + 18 );

    tft.setTextColor( isWhiteTheme ? TFT_BLACK : TFT_WHITE );
    tft.setFreeFont( NULL );
}

void handleNameInputTouch( int x, int y ) {
    const int by = 198, bh = 35;

    if ( y >= by && y <= by + bh ) {
        if ( x < 60 ) {                       // Shift
            keyboardShift = !keyboardShift;
        }
        else if ( x < 120 ) {                 // 123
            keyboardNumbers = !keyboardNumbers;
        }
        else if ( x < 180 ) {                 // Apaga
            if ( nameInput.length() > 0 ) {
                nameInput.remove( nameInput.length() - 1 );
            }
        }
        else if ( x < 250 ) {                 // SALVAR
            nameInput.trim();
            userName = nameInput;
            saveName();
            lastPeriod = -1;
            currentState = SETTINGS;
            drawSettingsScreen();
            return;
        }
        else {                                // VOLTAR (sem salvar)
            currentState = SETTINGS;
            drawSettingsScreen();
            return;
        }
        drawNameInputScreen();
        return;
    }

    if ( y >= 170 && y < 195 ) {              // Espaço
        if ( nameInput.length() < NAME_MAX_LEN ) {
            nameInput += " ";
            drawNameInputScreen();
        }
        return;
    }

    for ( int r = 0; r < 3; r++ ) {
        const char *row = keyboardRows( r );
        for ( int i = 0; i < ( int )strlen( row ); i++ ) {
            if ( x >= i * 29 && x <= i * 29 + 29 && y >= 80 + r * 30 && y <= 80 + r * 30 + 30 ) {
                char ch = row[ i ];
                if ( keyboardShift && !keyboardNumbers ) {
                    ch = toupper( ch );
                }
                if ( nameInput.length() < NAME_MAX_LEN ) {
                    nameInput += ch;
                }
                keyboardShift = false;
                drawNameInputScreen();
                return;
            }
        }
    }
}

// Chamado ao abrir a tela: começa com o nome atual, com a 1ª letra maiúscula
void nameInputBegin() {
    nameInput      = userName;
    keyboardShift  = ( userName.length() == 0 );
    keyboardNumbers = false;
}
