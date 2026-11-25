#pragma once

#include <Arduino.h>

// ============================================================
// Saudação na tela do relógio: "Bom dia / Boa tarde / Boa noite, <nome>"
// O nome é configurado em Ajustes > Nome e salvo na NVS.
// ============================================================

void   greetingInit();                 // setup(): carrega o nome salvo
String greetingGetName();

void drawGreeting();                   // desenha a saudação na coluna da esquerda
void drawGreetingIfPeriodChanged();    // chamar no loop: redesenha só quando muda dia/tarde/noite

void nameInputBegin();                 // prepara o teclado com o nome atual
void drawNameInputScreen();            // Ajustes > Nome (teclado)
void handleNameInputTouch( int x, int y );
