#include "alarm.h"

#include <TFT_eSPI.h>
#include <Preferences.h>
#include <time.h>

#include "../data/app_state.h"
#include "../hal/backlight.h"
#include "../ui/icons.h"
#include "../ui/screens.h"
#include "../ui/theme.h"

// ---------------------------------------------------------------------------
// Externs — defined in main.cpp
// ---------------------------------------------------------------------------
extern TFT_eSPI    tft;
extern ScreenState currentState;
extern int         lastSec;
extern int         menuOffset;
extern bool        isDimmed;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
struct AlarmSettings {
    bool    enabled = false;
    uint8_t hour    = 6;
    uint8_t minute  = 30;
    uint8_t days    = 0x3E;   // bit 0 = domingo ... bit 6 = sábado (padrão: seg a sex)
};

static AlarmSettings alarmCfg;
static bool          ringing          = false;
static unsigned long ringStartMs      = 0;
static long          lastTriggerKey   = -1;     // dia do ano * 1440 + minuto: dispara uma vez por minuto
static int           lampLevel        = 0;
static int           lampLevelBefore  = 0;      // restaurado quando o alarme para
static bool          ringOutputOn     = false;

static const char *DAY_LETTERS[ 7 ] = {"D", "S", "T", "Q", "Q", "S", "S"};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
static void alarmLoad() {
    Preferences p;
    if ( p.begin( "alarm", true ) ) {
        alarmCfg.enabled = p.getBool( "en", false );
        alarmCfg.hour    = p.getUChar( "h", 6 );
        alarmCfg.minute  = p.getUChar( "m", 30 );
        alarmCfg.days    = p.getUChar( "days", 0x3E );
        p.end();
    }
}

static void alarmSave() {
    Preferences p;
    if ( p.begin( "alarm", false ) ) {
        p.putBool( "en", alarmCfg.enabled );
        p.putUChar( "h", alarmCfg.hour );
        p.putUChar( "m", alarmCfg.minute );
        p.putUChar( "days", alarmCfg.days );
        p.end();
    }
}

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------
static void lampWrite( bool bottom, bool top ) {
    digitalWrite( LAMP_BOTTOM_PIN, bottom ? HIGH : LOW );
    digitalWrite( LAMP_TOP_PIN,    top    ? HIGH : LOW );
}

int lampGetLevel() {
    return lampLevel;
}

void lampSetLevel( int level ) {
    lampLevel = constrain( level, 0, 2 );
    if ( !ringing ) {
        lampWrite( lampLevel >= 1, lampLevel >= 2 );
    }
}

void lampNext() {
    lampSetLevel( lampLevel < 2 ? lampLevel + 1 : 2 );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
void alarmInit() {
    pinMode( LAMP_BOTTOM_PIN, OUTPUT );
    pinMode( LAMP_TOP_PIN, OUTPUT );
    lampWrite( false, false );
    alarmLoad();
    log_i( "[ALARM] %s %02d:%02d dias=0x%02X", alarmCfg.enabled ? "ativo" : "inativo",
           alarmCfg.hour, alarmCfg.minute, alarmCfg.days );
}

bool alarmIsRinging() {
    return ringing;
}

void alarmStartRinging() {
    if ( ringing ) {
        return;
    }
    ringing         = true;
    ringStartMs     = millis();
    ringOutputOn    = false;
    lampLevelBefore = lampLevel;
    if ( isDimmed ) {
        backlightCancelDim();
    }
    currentState = ALARMRINGING;
    drawAlarmRingingScreen();
    log_i( "[ALARM] Tocando" );
}

void alarmStop() {
    if ( !ringing ) {
        return;
    }
    ringing = false;
    noTone( SPEAKER_PIN );
    lampSetLevel( lampLevelBefore );
    currentState = CLOCK;
    lastSec      = -1;  // força o redesenho completo do relógio
    log_i( "[ALARM] Desligado" );
}

// Padrão do toque, em ciclos de 1,6 s: 4 bipes curtos (luzes acesas junto) e uma pausa
static bool ringPatternOn( unsigned long elapsed ) {
    unsigned long t = elapsed % 1600;
    if ( t >= 800 ) {
        return false;
    }
    return ( t % 200 ) < 120;
}

void alarmLoop() {
    if ( ringing ) {
        unsigned long elapsed = millis() - ringStartMs;
        if ( elapsed > ALARM_MAX_RING_MS ) {
            alarmStop();
            return;
        }
        bool on = ringPatternOn( elapsed );
        if ( on != ringOutputOn ) {
            ringOutputOn = on;
            lampWrite( on, on );
            if ( on ) {
                tone( SPEAKER_PIN, ALARM_TONE_HZ );
            }
            else {
                noTone( SPEAKER_PIN );
            }
        }
        return;
    }

    if ( !alarmCfg.enabled ) {
        return;
    }
    struct tm ti;
    if ( !getLocalTime( &ti, 0 ) ) {
        return;
    }
    if ( !( alarmCfg.days & ( 1 << ti.tm_wday ) ) ) {
        return;
    }
    if ( ti.tm_hour == alarmCfg.hour && ti.tm_min == alarmCfg.minute ) {
        long key = ( long )ti.tm_yday * 1440 + ti.tm_hour * 60 + ti.tm_min;
        if ( key != lastTriggerKey ) {
            lastTriggerKey = key;
            alarmStartRinging();
        }
    }
}

// ---------------------------------------------------------------------------
// Clock-screen buttons (bottom-left, where the moon phase text used to be)
// ---------------------------------------------------------------------------
static const int LUZ_X = 5,  LUZ_Y = 207, LUZ_W = 62, LUZ_H = 28;
static const int OFF_X = 72, OFF_Y = 207, OFF_W = 40, OFF_H = 28;

void drawLampButtons() {
    uint16_t bg  = getBgColor();
    uint16_t txt = getTextColor();

    tft.fillRect( LUZ_X, LUZ_Y, OFF_X + OFF_W - LUZ_X, LUZ_H, bg );

    // LUZ: two small squares show which lights are on (top = lâmpada de cima)
    uint16_t luzColor = lampLevel > 0 ? TFT_YELLOW : TFT_DARKGREY;
    tft.drawRoundRect( LUZ_X, LUZ_Y, LUZ_W, LUZ_H, 5, luzColor );
    tft.setTextDatum( MC_DATUM );
    tft.setTextColor( txt, bg );
    tft.drawString( "LUZ", LUZ_X + 22, LUZ_Y + LUZ_H / 2, 2 );
    int sqX = LUZ_X + LUZ_W - 14;
    if ( lampLevel >= 2 ) {
        tft.fillRect( sqX, LUZ_Y + 5, 8, 8, TFT_YELLOW );
    }
    else {
        tft.drawRect( sqX, LUZ_Y + 5, 8, 8, TFT_DARKGREY );
    }
    if ( lampLevel >= 1 ) {
        tft.fillRect( sqX, LUZ_Y + 15, 8, 8, TFT_YELLOW );
    }
    else {
        tft.drawRect( sqX, LUZ_Y + 15, 8, 8, TFT_DARKGREY );
    }

    tft.drawRoundRect( OFF_X, OFF_Y, OFF_W, OFF_H, 5, TFT_RED );
    tft.drawString( "OFF", OFF_X + OFF_W / 2, OFF_Y + OFF_H / 2, 2 );
}

static bool inRect( int x, int y, int rx, int ry, int rw, int rh ) {
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

bool handleLampTouch( int x, int y ) {
    if ( inRect( x, y, LUZ_X, LUZ_Y - 4, LUZ_W, LUZ_H + 8 ) ) {
        lampNext();
    }
    else if ( inRect( x, y, OFF_X, OFF_Y - 4, OFF_W + 4, OFF_H + 8 ) ) {
        lampSetLevel( 0 );
    }
    else {
        return false;
    }
    drawLampButtons();
    return true;
}

// ---------------------------------------------------------------------------
// Settings screen: Ajustes > Alarme
// ---------------------------------------------------------------------------
// Layout (320x240):
//   y  40- 80  [ATIVO/DESATIVADO]                    [TESTAR]
//   y  90-130  Hora    [-]  06  [+]
//   y 135-175  Min  [-5][-1] 30 [+1][+5]
//   y 190-225  D S T Q Q S S                          [voltar]
static const int ROW_TOGGLE_Y = 40,  ROW_H = 38;
static const int ROW_HOUR_Y   = 90;
static const int ROW_MIN_Y    = 136;
static const int ROW_DAYS_Y   = 190, DAY_W = 30, DAY_GAP = 4, DAY_X0 = 8;
static const int BACK_X       = 262, BACK_Y = 182;

static void drawButton( int x, int y, int w, int h, const char *label, uint16_t border, bool filled ) {
    uint16_t bg = getBgColor();
    if ( filled ) {
        tft.fillRoundRect( x, y, w, h, 5, border );
        tft.setTextColor( TFT_BLACK, border );
    }
    else {
        tft.fillRoundRect( x, y, w, h, 5, bg );
        tft.drawRoundRect( x, y, w, h, 5, border );
        tft.setTextColor( getTextColor(), bg );
    }
    tft.setTextDatum( MC_DATUM );
    tft.drawString( label, x + w / 2, y + h / 2, 2 );
}

static void drawAlarmToggle() {
    drawButton( 10, ROW_TOGGLE_Y, 130, ROW_H, alarmCfg.enabled ? "ATIVO" : "DESATIVADO",
                alarmCfg.enabled ? TFT_GREEN : TFT_DARKGREY, alarmCfg.enabled );
}

static void drawAlarmTime() {
    uint16_t bg = getBgColor();
    char buf[ 4 ];
    tft.setTextDatum( MC_DATUM );
    tft.setTextColor( getTextColor(), bg );

    tft.fillRect( 112, ROW_HOUR_Y, 50, ROW_H, bg );
    snprintf( buf, sizeof( buf ), "%02d", alarmCfg.hour );
    tft.drawString( buf, 137, ROW_HOUR_Y + ROW_H / 2, 4 );

    tft.fillRect( 112, ROW_MIN_Y, 50, ROW_H, bg );
    snprintf( buf, sizeof( buf ), "%02d", alarmCfg.minute );
    tft.drawString( buf, 137, ROW_MIN_Y + ROW_H / 2, 4 );
}

static void drawAlarmDays() {
    for ( int d = 0; d < 7; d++ ) {
        bool on = alarmCfg.days & ( 1 << d );
        drawButton( DAY_X0 + d * ( DAY_W + DAY_GAP ), ROW_DAYS_Y, DAY_W, 32, DAY_LETTERS[ d ],
                    on ? TFT_SKYBLUE : TFT_DARKGREY, on );
    }
}

void drawAlarmScreen() {
    uint16_t bg = getBgColor();
    tft.fillScreen( bg );
    tft.setTextDatum( MC_DATUM );
    tft.setTextColor( TFT_ORANGE, bg );
    tft.drawString( "ALARME", 160, 18, 4 );

    drawAlarmToggle();
    drawButton( 210, ROW_TOGGLE_Y, 100, ROW_H, "TESTAR", TFT_ORANGE, false );

    tft.setTextDatum( ML_DATUM );
    tft.setTextColor( getTextColor(), bg );
    tft.drawString( "Hora", 10, ROW_HOUR_Y + ROW_H / 2, 2 );
    tft.drawString( "Min", 10, ROW_MIN_Y + ROW_H / 2, 2 );

    drawButton( 62,  ROW_HOUR_Y, 46, ROW_H, "-", TFT_BLUE, false );
    drawButton( 166, ROW_HOUR_Y, 46, ROW_H, "+", TFT_BLUE, false );

    drawButton( 40,  ROW_MIN_Y, 34, ROW_H, "-5", TFT_BLUE, false );
    drawButton( 76,  ROW_MIN_Y, 34, ROW_H, "-1", TFT_BLUE, false );
    drawButton( 166, ROW_MIN_Y, 34, ROW_H, "+1", TFT_BLUE, false );
    drawButton( 202, ROW_MIN_Y, 34, ROW_H, "+5", TFT_BLUE, false );

    drawAlarmTime();
    drawAlarmDays();

    tft.drawRoundRect( BACK_X, BACK_Y, 50, 50, 4, TFT_RED );
    drawArrowBack( BACK_X, BACK_Y, TFT_RED );
}

static void addMinutes( int delta ) {
    int total = ( alarmCfg.hour * 60 + alarmCfg.minute + delta + 1440 ) % 1440;
    alarmCfg.hour   = total / 60;
    alarmCfg.minute = total % 60;
}

void handleAlarmScreenTouch( int x, int y ) {
    if ( inRect( x, y, BACK_X, BACK_Y, 50, 50 ) ) {
        alarmSave();
        currentState = SETTINGS;
        drawSettingsScreen();
        return;
    }
    if ( inRect( x, y, 10, ROW_TOGGLE_Y, 130, ROW_H ) ) {
        alarmCfg.enabled = !alarmCfg.enabled;
        alarmSave();
        drawAlarmToggle();
        return;
    }
    if ( inRect( x, y, 210, ROW_TOGGLE_Y, 100, ROW_H ) ) {
        alarmSave();
        alarmStartRinging();
        return;
    }

    bool timeChanged = true;
    if ( inRect( x, y, 62, ROW_HOUR_Y, 46, ROW_H ) ) {
        addMinutes( -60 );
    }
    else if ( inRect( x, y, 166, ROW_HOUR_Y, 46, ROW_H ) ) {
        addMinutes( 60 );
    }
    else if ( inRect( x, y, 40, ROW_MIN_Y, 34, ROW_H ) ) {
        addMinutes( -5 );
    }
    else if ( inRect( x, y, 76, ROW_MIN_Y, 34, ROW_H ) ) {
        addMinutes( -1 );
    }
    else if ( inRect( x, y, 166, ROW_MIN_Y, 34, ROW_H ) ) {
        addMinutes( 1 );
    }
    else if ( inRect( x, y, 202, ROW_MIN_Y, 34, ROW_H ) ) {
        addMinutes( 5 );
    }
    else {
        timeChanged = false;
    }
    if ( timeChanged ) {
        alarmSave();  // salva a cada toque: a tela volta sozinha ao relógio após 3 min parada
        drawAlarmTime();
        return;
    }

    for ( int d = 0; d < 7; d++ ) {
        if ( inRect( x, y, DAY_X0 + d * ( DAY_W + DAY_GAP ), ROW_DAYS_Y, DAY_W, 32 ) ) {
            alarmCfg.days ^= ( 1 << d );
            alarmSave();
            drawAlarmDays();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Ringing screen
// ---------------------------------------------------------------------------
static const int STOP_X = 40, STOP_Y = 130, STOP_W = 240, STOP_H = 80;

void drawAlarmRingingScreen() {
    uint16_t bg = getBgColor();
    tft.fillScreen( bg );
    tft.setTextDatum( MC_DATUM );
    tft.setTextColor( TFT_ORANGE, bg );
    tft.drawString( "ALARME", 160, 30, 4 );

    char buf[ 6 ];
    snprintf( buf, sizeof( buf ), "%02d:%02d", alarmCfg.hour, alarmCfg.minute );
    tft.setTextColor( getTextColor(), bg );
    tft.drawString( buf, 160, 80, 6 );

    tft.fillRoundRect( STOP_X, STOP_Y, STOP_W, STOP_H, 10, TFT_RED );
    tft.setTextColor( TFT_WHITE, TFT_RED );
    tft.drawString( "DESLIGAR", 160, STOP_Y + STOP_H / 2, 4 );
}

void handleAlarmRingingTouch( int x, int y ) {
    if ( inRect( x, y, STOP_X, STOP_Y, STOP_W, STOP_H ) ) {
        alarmStop();
    }
}
