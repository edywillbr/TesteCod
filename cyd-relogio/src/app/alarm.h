#pragma once

#include <Arduino.h>

// ============================================================
// Luz da luminária (dois estágios) e alarme
// ============================================================
// Estágio 1: só a luz de baixo.  Estágio 2: as duas.
// O alarme pisca as duas luzes em ritmo e toca bipes no alto-falante
// até alguém tocar em DESLIGAR (ou após ALARM_MAX_RING_MS).
// O alarme continua programado até ser desativado em Ajustes > Alarme.
// ============================================================

// Pinos livres da CYD (conectores laterais CN1/P3) e conector SPEAK
constexpr int LAMP_BOTTOM_PIN = 22;  // luz de baixo (estágio 1)
constexpr int LAMP_TOP_PIN    = 27;  // luz de cima  (estágio 2)
constexpr int SPEAKER_PIN     = 26;  // amplificador do conector SPEAK

constexpr unsigned long ALARM_MAX_RING_MS = 10UL * 60UL * 1000UL;  // para sozinho após 10 min
constexpr unsigned int  ALARM_TONE_HZ     = 2000;

// --- Ciclo de vida (chamar em setup() e loop()) ---
void alarmInit();
void alarmLoop();

// --- Alarme ---
bool alarmIsRinging();
void alarmStartRinging();   // também usado pelo botão TESTAR
void alarmStop();

// --- Luz ---
int  lampGetLevel();        // 0 = desligada, 1 = baixo, 2 = as duas
void lampSetLevel( int level );
void lampNext();            // 0 -> 1 -> 2 (fica em 2)

// --- Interface ---
void drawLampButtons();                      // botões LUZ / OFF na tela do relógio
bool handleLampTouch( int x, int y );        // true se o toque foi num dos botões
void drawAlarmScreen();                      // Ajustes > Alarme
void handleAlarmScreenTouch( int x, int y );
void drawAlarmRingingScreen();               // tela com o botão DESLIGAR
void handleAlarmRingingTouch( int x, int y );
