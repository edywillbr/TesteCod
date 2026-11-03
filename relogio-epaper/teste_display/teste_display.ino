/*
  Teste mínimo do display WeAct 1.54" (sem Wi-Fi, sem clima)
  Serve para separar problema de fiação de problema de código.

  Esperado:
    1. Tela pisca e mostra moldura, "TESTE OK", a rotação e um contador.
    2. A cada 5 s o contador sobe (atualização parcial, sem piscar).
    3. Monitor Serial (115200) mostra cada passo e o estado do pino BUSY.
*/

#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

// Mesmos pinos do relógio
#define EPD_BUSY 4
#define EPD_RST  5
#define EPD_DC   6
#define EPD_CS   7
#define EPD_SCK  15   // pino "SCL" do display
#define EPD_MOSI 16   // pino "SDA" do display

#define ROTACAO 2     // 2 = 180°, igual ao relógio

GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(
    GxEPD2_154_D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

int contador = 0;

void desenha(bool completa) {
  if (completa) display.setFullWindow();
  else          display.setPartialWindow(0, 0, display.width(), display.height());

  uint32_t t0 = millis();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.drawRect(0, 0, 200, 200, GxEPD_BLACK);
    display.drawRect(3, 3, 194, 194, GxEPD_BLACK);
    display.fillTriangle(10, 10, 30, 10, 10, 30, GxEPD_BLACK);  // marca o canto "superior esquerdo"

    display.setFont(&FreeSansBold9pt7b);
    display.setCursor(50, 45);
    display.print("TESTE OK");
    display.setCursor(50, 70);
    display.printf("Rotacao %d", ROTACAO);

    display.setFont(&FreeSansBold24pt7b);
    display.setCursor(60, 150);
    display.printf("%03d", contador);
  } while (display.nextPage());
  display.powerOff();

  Serial.printf("Tela %s em %lu ms (BUSY=%d)\n", completa ? "completa" : "parcial",
                millis() - t0, digitalRead(EPD_BUSY));
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // tempo para abrir o Monitor Serial
  Serial.println("\n== Teste do display ==");

  pinMode(EPD_BUSY, INPUT);
  Serial.printf("BUSY antes do init: %d (esperado 0 com o display parado)\n", digitalRead(EPD_BUSY));

  SPI.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.init(115200, true, 2, false);  // o "true" liga as mensagens de diagnóstico da GxEPD2
  display.setRotation(ROTACAO);
  display.setTextColor(GxEPD_BLACK);

  desenha(true);
}

void loop() {
  delay(5000);
  contador++;
  desenha(contador % 10 == 0);  // completa a cada 10, parcial nas outras
}
